import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
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
import { EmailService, NoopEmailService } from '../common/email.service';
import { OtpService, OTP_PURPOSES } from '../common/otp.service';
import { generateProvisionalPassword } from '../common/provisional-password';
import { primaryEmail, resolvePasswordOtpTarget } from '../common/email-target';
import { maskEmail } from '../common/mask-email';
import {
  type EmailContent,
  defaultResendMessage,
  passwordResetCodeEmail,
  resendCredentialsEmail,
} from '../common/email-templates';
import { ORG_ID, ORG_OBJECT_TYPE } from '../common/org.constant';
import type { AuthUser } from '../authz/auth-user.types';
import { CurrentUser } from './current-user.decorator';
import { CompleteFirstLoginDto } from './dto/complete-first-login.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
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
  /** true si firmar el checklist es obligatorio (#68 Fase 2; controlado por env). */
  checklistSignatureRequired: boolean;
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
  // Rol conductor: reportar uso (tomar/liberar) enciende Recursos para llegar
  // al catálogo de vehículos y su checklist.
  'asset:use:report': 'recursos',
  'vmetric:view': 'v-metric',
};

/** Respuesta de completar el primer login. */
interface FirstLoginCompleteResponse {
  status: 'ACTIVE';
}

/**
 * Resultado de `forgot-password`: qué se hizo y a qué correo enmascarado.
 * - `CREDENTIAL_RESENT`: cuenta pendiente, se reenvió una credencial provisoria.
 * - `OTP_SENT`: cuenta activa, se envió un código para restablecer la contraseña.
 */
interface ForgotPasswordResponse {
  kind: 'CREDENTIAL_RESENT' | 'OTP_SENT';
  maskedEmail: string;
}

/**
 * Endpoints de sesión (Etapa 0.5). Dependen de `SessionMiddleware`, que puebla
 * `request.authUser` a partir del Bearer token (JWT propio). Cuando no hay
 * usuario autenticado, los handlers responden 401 explícitamente.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  /** Máximo de intentos fallidos consecutivos antes de bloquear la cuenta (#67). */
  private static readonly MAX_FAILED_ATTEMPTS = 10;
  /** Duración del bloqueo temporal por exceso de intentos (#67): 15 minutos. */
  private static readonly LOCKOUT_MS = 15 * 60 * 1000;
  /**
   * Cooldown por cuenta entre recuperaciones de clave (#66): 60 s. Limita, por
   * CUENTA (no por IP), el reenvío de credencial y el envío de OTP, cortando el
   * email-bombing y el DoS de credencial de una cuenta pendiente que un pool de IPs
   * podría causar evadiendo el throttle por IP.
   */
  private static readonly RECOVERY_COOLDOWN_MS = 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly fga: FgaService,
    private readonly permissions: PermissionService,
    private readonly otp: OtpService,
    private readonly email: EmailService,
  ) {}

  /** Login propio: valida username+contraseña y emite nuestro JWT. 401 genérico si no matchea. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5/min por IP: mitiga fuerza bruta de credenciales
  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async login(@Body() body: LoginDto): Promise<{ token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { username: body.username },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        tokenVersion: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });
    // Se valida la clave PRIMERO. El lockout (#67) solo debe frenar intentos
    // ERRÓNEOS: quien conoce su clave entra siempre, aunque la cuenta esté bloqueada
    // (así un DoS dirigido por bloqueo no deja afuera al dueño legítimo). Un atacante
    // con clave inválida sí queda sujeto al gate de lockout, abajo.
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      // Credenciales inválidas. Cuenta existente: si ya está bloqueada -> 429; si no,
      // se cuenta el intento (y se bloquea al llegar al tope). Username inexistente:
      // nada que contar, solo el 401 genérico anti-enumeración (defensa: throttle IP).
      if (user) {
        this.assertNotLockedOut(user.lockedUntil);
        await this.registerFailedLogin(user.id);
      }
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }
    // Clave correcta: limpia contador/bloqueo si traía intentos acumulados.
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
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
      checklistSignatureRequired: process.env.CHECKLIST_SIGNATURE_REQUIRED === 'true',
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

  /**
   * Inicia la recuperación de contraseña (#66). Un único endpoint que bifurca por
   * estado de la cuenta:
   *  - `PENDING_FIRST_LOGIN` (nunca ingresó): REGENERA la credencial provisoria y
   *    la reenvía al correo primario (mismo mecanismo que el reenvío del admin).
   *  - `ACTIVE`: envía un OTP de 6 dígitos al correo de contraseña; el usuario lo
   *    canjea en `reset-password` por una clave nueva.
   * En ambos casos devuelve el correo ENMASCARADO a donde se envió, para que el
   * dueño confirme el destino sin exponerlo. Solo opera si la cuenta existe
   * (decisión de producto); el throttle por IP (5/min) mitiga la enumeración.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // recuperación: 5/min por IP
  @Post('forgot-password')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<ForgotPasswordResponse> {
    const user = await this.prisma.user.findUnique({
      where: { username: body.username },
      select: {
        id: true,
        firstName: true,
        username: true,
        status: true,
        email: true,
        emailInstitucional: true,
        emailPersonal: true,
        emailInstitucionalVerified: true,
        emailPersonalVerified: true,
        lastRecoveryAt: true,
      },
    });
    // Cuenta inexistente O suspendida -> misma respuesta neutra. No se filtra el
    // estado SUSPENDED a un no autenticado (alinea con la anti-enumeración A1 del
    // login, donde "suspendida" solo se revela tras validar la clave correcta).
    if (!user || user.status === 'SUSPENDED') {
      throw new UnauthorizedException('No existe una cuenta con ese usuario.');
    }

    const isPending = user.status === 'PENDING_FIRST_LOGIN';
    // Destino del envío: cuenta pendiente -> correo primario (sin exigir verificación);
    // cuenta activa -> el mismo destino que verificará reset-password.
    const to = isPending ? primaryEmail(user) : resolvePasswordOtpTarget(user);
    this.assertCanEmail(to);
    const kind: ForgotPasswordResponse['kind'] = isPending ? 'CREDENTIAL_RESENT' : 'OTP_SENT';

    // Cooldown por CUENTA: si ya se inició una recuperación hace menos de
    // RECOVERY_COOLDOWN_MS, NO se reenvía/rota ni se genera un OTP nuevo. Corta el
    // email-bombing y el DoS de credencial de una cuenta pendiente que un pool de IPs
    // causaría evadiendo el throttle por IP. Se responde la MISMA forma (no expone el
    // detalle del cooldown ni el estado de la cuenta).
    if (
      user.lastRecoveryAt &&
      Date.now() - user.lastRecoveryAt.getTime() < AuthController.RECOVERY_COOLDOWN_MS
    ) {
      return { kind, maskedEmail: maskEmail(to) };
    }

    if (isPending) {
      const provisional = generateProvisionalPassword();
      // Enviar ANTES de rotar la clave: si el correo falla (502), la credencial
      // vigente del usuario sigue sirviendo — no lo dejamos sin acceso ni correo.
      await this.sendOrFail(
        to,
        resendCredentialsEmail({
          nombre: user.firstName,
          username: user.username,
          provisionalPassword: provisional,
          loginUrl: this.loginUrl(),
          subject: '',
          message: defaultResendMessage(),
        }),
        'la credencial de recuperación',
      );
      const passwordHash = await hashPassword(provisional);
      await this.prisma.user.update({
        where: { id: user.id },
        // Rotar la clave invalida la provisoria anterior; el bump de tokenVersion
        // invalida tokens pendientes; se limpia el lockout de una recuperación legítima
        // y se marca `lastRecoveryAt` para el cooldown por cuenta.
        data: {
          passwordHash,
          status: 'PENDING_FIRST_LOGIN',
          tokenVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastRecoveryAt: new Date(),
        },
      });
      return { kind: 'CREDENTIAL_RESENT', maskedEmail: maskEmail(to) };
    }

    // Cuenta ACTIVA: OTP de recuperación al mismo destino que verifica reset-password.
    const code = await this.otp.generate(to, OTP_PURPOSES.RESET_PASSWORD);
    await this.sendOrFail(to, passwordResetCodeEmail(code), 'el código de recuperación');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastRecoveryAt: new Date() } });
    return { kind: 'OTP_SENT', maskedEmail: maskEmail(to) };
  }

  /**
   * Cierra la recuperación de una cuenta ACTIVA (#66): valida el OTP enviado por
   * `forgot-password` y fija la nueva contraseña. Sube `tokenVersion` (cierra las
   * sesiones previas) y limpia el lockout. Las cuentas PENDING/SUSPENDED no pasan
   * por aquí (usan el reenvío de credencial o no recuperan).
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // recuperación: 5/min por IP
  @Post('reset-password')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async resetPassword(@Body() body: ResetPasswordDto): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { username: body.username },
      select: {
        id: true,
        status: true,
        email: true,
        emailInstitucional: true,
        emailPersonal: true,
        emailInstitucionalVerified: true,
        emailPersonalVerified: true,
      },
    });
    // Inexistente O no-ACTIVA (PENDING/SUSPENDED) -> mismo 401 neutro: no se filtra el
    // estado por este endpoint (las cuentas PENDING usan el reenvío de credencial, no
    // el OTP; las SUSPENDED no recuperan). Alinea con la anti-enumeración de forgot-password.
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('No existe una cuenta con ese usuario.');
    }
    const to = resolvePasswordOtpTarget(user);
    // Verifica y consume el OTP (lanza si no hay / expiró / bloqueado / incorrecto).
    await this.otp.verify(to, OTP_PURPOSES.RESET_PASSWORD, body.code);
    const passwordHash = await hashPassword(body.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    return { ok: true };
  }

  /** 429 con minutos restantes si la cuenta está bloqueada temporalmente (#67). */
  private assertNotLockedOut(lockedUntil: Date | null): void {
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      const mins = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
      throw new HttpException(
        `Demasiados intentos fallidos. Tu cuenta está bloqueada temporalmente. Intenta de nuevo en ${mins} ${
          mins === 1 ? 'minuto' : 'minutos'
        }.`,
        429,
      );
    }
  }

  /**
   * Registra un intento de login fallido de una cuenta EXISTENTE. Incrementa el
   * contador de forma ATÓMICA y decide el bloqueo a partir del valor que devuelve la
   * BD (no de un valor leído antes): así dos intentos fallidos concurrentes no se
   * pisan el contador (evita el lost-update que dejaría evadir el tope). Al alcanzar
   * el tope, bloquea `LOCKOUT_MS` y resetea el contador (ventana limpia tras el bloqueo).
   */
  private async registerFailedLogin(userId: string): Promise<void> {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts >= AuthController.MAX_FAILED_ATTEMPTS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + AuthController.LOCKOUT_MS),
        },
      });
      this.logger.warn(
        `Cuenta ${userId} bloqueada ${AuthController.LOCKOUT_MS / 60_000} min tras ${
          AuthController.MAX_FAILED_ATTEMPTS
        } intentos fallidos de login.`,
      );
    }
  }

  /** ¿Hay un proveedor de correo real activo (no el Noop de "sin envío")? */
  private isRealEmailProvider(): boolean {
    return !(this.email instanceof NoopEmailService);
  }

  /** URL de login del frontend para los correos (configurable por env). */
  private loginUrl(): string {
    return process.env.APP_WEB_URL || 'https://web-dev-production-05f2.up.railway.app';
  }

  /** 409 si no se puede enviar correo (sin destinatario o sin proveedor real). */
  private assertCanEmail(to: string): void {
    if (to.length === 0 || !this.isRealEmailProvider()) {
      throw new ConflictException(
        'No podemos enviar el correo de recuperación: tu cuenta no tiene un correo válido configurado. Contacta a un administrador.',
      );
    }
  }

  /** Envía un correo; 502 con mensaje claro si el proveedor falla. */
  private async sendOrFail(to: string, content: EmailContent, what: string): Promise<void> {
    try {
      await this.email.send({ to, ...content });
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo enviar ${what} a ${to}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HttpException(
        { code: 'EMAIL_SEND_FAILED', message: 'No se pudo enviar el correo. Intenta de nuevo en unos minutos.' },
        502,
      );
    }
  }
}
