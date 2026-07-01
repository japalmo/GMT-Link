import {
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../modules/gamification/gamification.service';
import type { AuthUser } from '../authz/auth-user.types';
import { CurrentUser } from './current-user.decorator';
import { CompleteFirstLoginDto } from './dto/complete-first-login.dto';
import { LoginDto } from './dto/login.dto';
import { FirebaseService } from './firebase.service';
import { verifyPassword } from '../common/password';
import { signToken } from '../common/jwt';
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
 * `request.authUser` y `request.firebaseUid` a partir del Bearer token. Cuando
 * no hay usuario autenticado, los handlers responden 401 explícitamente.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
    private readonly gamification: GamificationService,
  ) {}

  /** Login propio: valida email+contraseña y emite nuestro JWT. 401 genérico si no matchea. */
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

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      modules: await this.resolveModules(user.id),
    };
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
   * Completa el primer login: fija la contraseña en Firebase y activa la cuenta.
   * Requiere sesión (401), que el usuario esté en `PENDING_FIRST_LOGIN`
   * (409 si ya está activo/otro estado) y un `uid` de Firebase en el token.
   */
  @Post('first-login/complete')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async completeFirstLogin(
    @CurrentUser() authUser: AuthUser | undefined,
    @Req() req: Request,
    @Body() body: CompleteFirstLoginDto,
  ): Promise<FirstLoginCompleteResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    const firebaseUid = req.firebaseUid;
    if (!firebaseUid) {
      throw new UnauthorizedException('Falta el identificador de Firebase en la sesión.');
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

    await this.firebase.setPassword(firebaseUid, body.newPassword);
    await this.prisma.user.update({
      where: { id: authUser.id },
      data: { status: 'ACTIVE' },
    });

    // Gamificación: otorgar puntos por primer login (best-effort)
    void this.gamification.awardPoints(authUser.id, 'FIRST_LOGIN');

    return { status: 'ACTIVE' };
  }
}
