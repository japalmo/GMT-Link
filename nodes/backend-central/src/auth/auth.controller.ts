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
  /** Módulos del sidebar visibles para este usuario (derivados de su cliente). */
  modules: string[];
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
  'recursos',
  'herramientas',
  'v-metric',
] as const;

/**
 * Módulos visibles por código de cliente (Módulo 5 — "limitar acceso estricto").
 * Reemplaza el filtro por dominio de email del sidebar. Un usuario sin cliente
 * conocido (p. ej. org_admin) ve TODOS los módulos.
 */
const CLIENT_MODULES: Record<string, readonly string[]> = {
  CAP: ['dashboard', 'operaciones'], // Capstone / Mantos Blancos
  ALB: ['dashboard', 'v-metric'], // Albemarle / Salar de Atacama
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
  ) {}

  /** Login propio: valida email+contraseña y emite nuestro JWT. 401 genérico si no matchea. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5/min por IP: mitiga fuerza bruta de credenciales
  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async login(@Body() body: LoginDto): Promise<{ token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, passwordHash: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    return { token: signToken(user.id) };
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

    // En paralelo: módulos (Postgres) + gate de roles (FGA) — /me es el endpoint
    // más caliente de la web y ambos resuelven independientes.
    const [modules, canManageRoles] = await Promise.all([
      this.resolveModules(user.id),
      this.resolveCanManageRoles(authUser.id),
    ]);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      modules,
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
   * Deriva los módulos visibles del usuario a partir de su(s) cliente(s) reales
   * (vía Membership PROJECT → Project → Client). org_admin o cliente desconocido
   * → todos los módulos (no se restringe).
   */
  private async resolveModules(userId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({ where: { userId } });
    if (memberships.length === 0 || memberships.some((m) => m.roleKey === 'org_admin')) {
      return [...ALL_MODULES];
    }
    const projectIds = memberships
      .filter((m) => m.scopeType === 'PROJECT')
      .map((m) => m.scopeId);
    const projects = projectIds.length
      ? await this.prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { client: { select: { code: true } } },
        })
      : [];
    const knownCodes = [...new Set(projects.map((p) => p.client.code))].filter(
      (code) => CLIENT_MODULES[code] !== undefined,
    );
    if (knownCodes.length === 0) {
      return [...ALL_MODULES];
    }
    const set = new Set<string>();
    for (const code of knownCodes) {
      for (const mod of CLIENT_MODULES[code] ?? []) set.add(mod);
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
      select: { status: true },
    });
    if (!user) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }
    if (user.status !== 'PENDING_FIRST_LOGIN') {
      throw new ConflictException('El primer login ya fue completado.');
    }
    const passwordHash = await hashPassword(body.newPassword);
    await this.prisma.user.update({
      where: { id: authUser.id },
      data: { passwordHash, status: 'ACTIVE' },
    });
    void this.gamification.awardPoints(authUser.id, 'FIRST_LOGIN');
    return { status: 'ACTIVE' };
  }
}
