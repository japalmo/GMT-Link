import {
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../modules/gamification/gamification.service';
import { FgaService } from '../fga/fga.service';
import { PermissionService } from '../authz/permission.service';
import { ORG_ID, ORG_OBJECT_TYPE } from '../common/org.constant';
import type { AuthUser } from '../authz/auth-user.types';
import { CurrentUser } from './current-user.decorator';
import { CompleteFirstLoginDto } from './dto/complete-first-login.dto';
import { LoginDto } from './dto/login.dto';
import { hashPassword, verifyPassword } from '../common/password';
import { signToken } from '../common/jwt';
import { Throttle } from '@nestjs/throttler';
import './auth-request.types';

/** Vista pública del usuario autenticado. Nunca expone campos internos. */
interface MeResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  /** Módulos del sidebar visibles para este usuario (derivados de sus permisos). */
  modules: string[];
  /** Permisos efectivos del usuario (para gating por permiso en el front). */
  permissions: string[];
  /** true si el usuario tiene `can_manage_roles` sobre `organization:gmt` (§8, Fase 4 RBAC). */
  canManageRoles: boolean;
}

/** Todos los módulos del sidebar. */
const ALL_MODULES = [
  'dashboard',
  'usuarios',
  'directorio',
  'finanzas',
  'operaciones',
  'proyectos',
  'recursos',
  'herramientas',
  'v-metric',
] as const;

/** Módulos visibles para TODO usuario autenticado (Inicio + Finanzas; Config/Perfil son footer). */
const DEFAULT_MODULES: readonly string[] = ['dashboard', 'finanzas'];

/** Mapa permiso→módulo: tener el permiso enciende el módulo (spec §3.1). */
const PERMISSION_MODULE: Readonly<Record<string, string>> = {
  'project:view:all': 'proyectos',
  'project:manage': 'proyectos',
  'user:read': 'usuarios',
  'user:create': 'usuarios',
  'user:update': 'usuarios',
  'directory:view:extended': 'directorio',
  'task:read': 'operaciones',
  'task:create': 'operaciones',
  'asset:manage': 'recursos',
  'asset:fields:edit': 'recursos',
  'asset:read': 'recursos',
  'vmetric:view': 'v-metric',
};

/** Respuesta de completar el primer login. */
interface FirstLoginCompleteResponse {
  status: 'ACTIVE';
}

/**
 * Endpoints de sesión (Etapa 0.5). Dependen de `SessionMiddleware`, que puebla
 * `request.authUser` a partir del Bearer token (JWT propio). Cuando no hay
 * usuario autenticado, los handlers responden 401 explícitamente.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly fga: FgaService,
    private readonly permissions: PermissionService,
  ) {}

  /** Login propio: valida username+contraseña y emite nuestro JWT. 401 genérico si no matchea. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5/min por IP: mitiga fuerza bruta de credenciales
  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async login(@Body() body: LoginDto): Promise<{ token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { username: body.username },
      select: { id: true, passwordHash: true, status: true, tokenVersion: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }
    // Bloqueo de cuentas suspendidas (hallazgo A1). Se evalúa RECIÉN tras validar
    // las credenciales: así solo el dueño de la clave correcta descubre que la
    // cuenta está suspendida — un atacante con credenciales inválidas sigue viendo
    // el 401 genérico (anti-enumeración intacta). `PENDING_FIRST_LOGIN` NO se
    // bloquea aquí: ese flujo debe poder loguear para completar el primer acceso.
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Tu cuenta está suspendida. Contacta a un administrador.');
    }
    return { token: signToken(user.id, user.tokenVersion) };
  }

  /** Datos del usuario autenticado. 401 si no hay sesión. */
  @Get('me')
  async me(@CurrentUser() authUser: AuthUser | undefined): Promise<MeResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }

    // En paralelo: permisos efectivos (Postgres) + gate de roles (FGA) — /me es el
    // endpoint más caliente de la web y ambos resuelven independientes. Los módulos
    // se derivan de los permisos (+ una lectura de memberships para el gate org_admin).
    const [permissions, canManageRoles] = await Promise.all([
      this.permissions.permissionKeysForUser(user.id),
      this.resolveCanManageRoles(authUser.id),
    ]);
    const modules = await this.resolveModules(user.id, permissions);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      modules,
      permissions,
      canManageRoles,
    };
  }

  /**
   * ¿Tiene el usuario `can_manage_roles` sobre `organization:gmt`? (§8, Fase 4 RBAC).
   * Fail-closed: si OpenFGA no responde (caído / sin bootstrap), devuelve `false`
   * en vez de romper el /me con 500 — este endpoint se consulta en cada carga
   * de la web y no puede depender de la disponibilidad de FGA.
   */
  private async resolveCanManageRoles(userId: string): Promise<boolean> {
    try {
      return await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_roles',
        object: `${ORG_OBJECT_TYPE}:${ORG_ID}`,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `FGA no disponible al resolver can_manage_roles en /auth/me (fail-closed → false): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Módulos visibles del usuario, DERIVADOS de sus permisos (spec §3.1).
   * - org_admin (membresía) o `system:beta:full` → todos los módulos.
   * - resto → DEFAULT_MODULES (Inicio + Finanzas) + los que encienda PERMISSION_MODULE.
   * Config y Perfil no son módulos (links de footer, siempre visibles).
   */
  private async resolveModules(userId: string, permissions: string[]): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({ where: { userId } });
    const isOrgAdmin = memberships.some((m) => m.roleKey === 'org_admin');
    if (isOrgAdmin || permissions.includes('system:beta:full')) {
      return [...ALL_MODULES];
    }
    const set = new Set<string>(DEFAULT_MODULES);
    for (const perm of permissions) {
      const mod = PERMISSION_MODULE[perm];
      if (mod !== undefined) set.add(mod);
    }
    return [...set];
  }

  /**
   * Completa el primer login: fija la contraseña (bcrypt) y activa la cuenta.
   * Requiere sesión (401) y que el usuario esté en `PENDING_FIRST_LOGIN`
   * (409 si ya está activo/otro estado).
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // cambio de credenciales: 5/min por IP
  @Post('first-login/complete')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async completeFirstLogin(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() body: CompleteFirstLoginDto,
  ): Promise<FirstLoginCompleteResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { status: true, passwordHash: true },
    });
    if (!user) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }
    if (user.status !== 'PENDING_FIRST_LOGIN') {
      throw new ConflictException('El primer login ya fue completado.');
    }
    // Re-autenticación: exigir la contraseña provisoria vigente antes de fijar la
    // nueva. Un token filtrado en estado pendiente (JWT 7d, sin revocación) no
    // basta para tomar control de la cuenta sin conocer la clave provisoria.
    const provisionalOk = user.passwordHash
      ? await verifyPassword(body.currentPassword, user.passwordHash)
      : false;
    if (!provisionalOk) {
      throw new UnauthorizedException('La contraseña provisoria no es correcta.');
    }
    const passwordHash = await hashPassword(body.newPassword);
    await this.prisma.user.update({
      where: { id: authUser.id },
      // firstLoginAt marca la invitación como USADA (distingue "invitada pendiente"
      // de "suspendida tras uso" en la gestión de usuarios).
      data: { passwordHash, status: 'ACTIVE', firstLoginAt: new Date() },
    });
    void this.gamification.awardPoints(authUser.id, 'FIRST_LOGIN');
    return { status: 'ACTIVE' };
  }
}
