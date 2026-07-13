import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { ORG_ID } from '../../common/org.constant';
import { isRoleKey } from '../../common/role-keys';
import type { RoleKey } from '../../common/role-keys';
import { hashPassword, verifyPassword } from '../../common/password';
import { signToken } from '../../common/jwt';
import { EmailService } from '../../common/email.service';
import { verificationCodeEmail, passwordChangeCodeEmail } from '../../common/email-templates';
import { OtpService, OTP_PURPOSES } from '../../common/otp.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChangeEmailRequestDto } from './dto/change-email-request.dto';
import type { ChangeEmailConfirmDto } from './dto/change-email-confirm.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordResponse, OkResponse, ProfileMe } from './profile.types';

/** Usuario con sus memberships, forma común de las consultas de este servicio. */
type UserWithMemberships = Prisma.UserGetPayload<{ include: { memberships: true } }>;

/**
 * Perfil propio del usuario autenticado (§6-1.3 "Mis datos").
 *
 * Regla de seguridad transversal: el servicio SIEMPRE recibe el `userId` del
 * controller (derivado de `request.authUser`, nunca del body). Así PATCH y
 * change-password operan exclusivamente sobre el propio usuario; el cliente no
 * puede inyectar un id ajeno.
 *
 * Campos editables (§4.2 / nota del prompt): firstName, secondName?, lastName,
 * secondLastName?, avatarUrl?. NO se permite cambiar email (identidad →
 * solo lectura), status, roles ni points: el `data` de Prisma se arma a mano con
 * solo los campos del DTO, así que esos campos jamás se escriben desde aquí.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly emailService: EmailService,
  ) {}

  /** Perfil propio. 404 si el usuario de la sesión ya no existe en Postgres. */
  async getMe(userId: string): Promise<ProfileMe> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: true },
    });
    if (!user) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }
    return this.toProfile(user);
  }

  /**
   * Actualiza SOLO el propio usuario con los campos del DTO. Construye `data`
   * explícitamente (whitelist de campos editables): email/status/roles/points
   * nunca se incluyen. Strings vacíos en los segundos nombres/avatar se
   * normalizan a null (limpiar el campo).
   */
  async updateMe(userId: string, dto: UpdateProfileDto): Promise<ProfileMe> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName;
    }
    if (dto.secondName !== undefined) {
      data.secondName = normalizeOptional(dto.secondName);
    }
    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName;
    }
    if (dto.secondLastName !== undefined) {
      data.secondLastName = normalizeOptional(dto.secondLastName);
    }
    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = normalizeOptional(dto.avatarUrl);
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
        include: { memberships: true },
      });
      return this.toProfile(user);
    } catch (error: unknown) {
      // P2025 = registro a actualizar no encontrado (usuario de sesión borrado).
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException('El usuario de la sesión ya no existe.');
      }
      throw error;
    }
  }

  /**
   * Solicita el OTP para cambiar el correo del PROPIO usuario. ENDURECIDO: exige
   * la contraseña actual (401 si no coincide) antes de gastar OTP/correo, para
   * cortar el secuestro de sesión (el OTP viaja al correo NUEVO, así que no
   * autentica al dueño). Valida formato y unicidad (409 si el `newEmail` ya lo usa
   * OTRO usuario como email primario o institucional), registra el cambio como
   * pendiente y envía el código al nuevo correo. El código NO se retorna: viaja
   * solo por `EmailService`.
   */
  async requestEmailChange(userId: string, dto: ChangeEmailRequestDto): Promise<OkResponse> {
    const newEmail = dto.newEmail.trim();

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('La contraseña actual no es válida.');
    }
    const matches = await verifyPassword(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('La contraseña actual no es válida.');
    }

    await this.assertEmailAvailable(newEmail, userId);

    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingEmail: newEmail, pendingEmailKind: dto.kind },
    });

    const code = await this.otp.generate(newEmail, OTP_PURPOSES.CHANGE_EMAIL);
    await this.emailService.send({ to: newEmail, ...verificationCodeEmail(code) });

    return { ok: true };
  }

  /**
   * Confirma el cambio de correo pendiente con el OTP. Aplica `pendingEmail` al
   * campo indicado por `pendingEmailKind`, marca ese correo como verificado
   * (timestamp), limpia el pendiente y RECOMPUTA el `email` primario
   * (= emailInstitucional ?? emailPersonal, §4.1 D1) respetando "al menos un
   * correo". 409 si el correo colisiona con otro usuario al persistir.
   */
  async confirmEmailChange(userId: string, dto: ChangeEmailConfirmDto): Promise<ProfileMe> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: true },
    });
    if (!user) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }
    if (!user.pendingEmail || !user.pendingEmailKind) {
      throw new BadRequestException('No hay un cambio de correo pendiente de confirmar.');
    }

    const pendingEmail = user.pendingEmail;
    const kind = user.pendingEmailKind;

    // Verifica y consume el OTP del correo pendiente (lanza si inválido/expirado).
    await this.otp.verify(pendingEmail, OTP_PURPOSES.CHANGE_EMAIL, dto.code);

    const now = new Date();
    const data: Prisma.UserUpdateInput = { pendingEmail: null, pendingEmailKind: null };
    if (kind === 'INSTITUCIONAL') {
      data.emailInstitucional = pendingEmail;
      data.emailInstitucionalVerified = now;
    } else {
      data.emailPersonal = pendingEmail;
      data.emailPersonalVerified = now;
    }

    // Recomputa el email primario tras aplicar el nuevo correo (§4.1 D1).
    const nextInstitucional = kind === 'INSTITUCIONAL' ? pendingEmail : user.emailInstitucional;
    const nextPersonal = kind === 'PERSONAL' ? pendingEmail : user.emailPersonal;
    const nextPrimary = nextInstitucional ?? nextPersonal;
    if (!nextPrimary) {
      // "Al menos un correo" (§4.1): defensivo — acabamos de setear uno, no debería ocurrir.
      throw new BadRequestException('El usuario debe conservar al menos un correo.');
    }
    data.email = nextPrimary;

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
        include: { memberships: true },
      });
      return this.toProfile(updated);
    } catch (error: unknown) {
      // P2002 = violación de unique (email / emailInstitucional) por carrera con otro usuario.
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('El correo ya está en uso por otro usuario.');
      }
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException('El usuario de la sesión ya no existe.');
      }
      throw error;
    }
  }

  /**
   * Solicita el OTP para cambiar la contraseña. Lo envía al primer correo
   * VERIFICADO del usuario (institucional → personal), o al `email` primario si
   * ninguno está verificado. El mismo destino se usa al confirmar (change-password),
   * garantizando que el código generado y el verificado coincidan.
   */
  async requestPasswordChange(userId: string): Promise<OkResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }

    const target = this.resolvePasswordOtpTarget(user);
    const code = await this.otp.generate(target, OTP_PURPOSES.CHANGE_PASSWORD);
    await this.emailService.send({ to: target, ...passwordChangeCodeEmail(code) });

    return { ok: true };
  }

  /**
   * Cambia la contraseña del PROPIO usuario en Postgres (bcrypt), ENDURECIDO:
   * exige la contraseña actual (401 si no coincide) y el OTP enviado por
   * `requestPasswordChange` (verificado contra el mismo destino). Recibe el
   * `userId` de la sesión (no del body). Solo entonces hashea y persiste.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<ChangePasswordResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('La contraseña actual no es válida.');
    }

    const matches = await verifyPassword(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('La contraseña actual no es válida.');
    }

    // Verifica el OTP contra el mismo destino que usó el request (consistencia).
    const target = this.resolvePasswordOtpTarget(user);
    await this.otp.verify(target, OTP_PURPOSES.CHANGE_PASSWORD, dto.code);

    // Cambiar la clave CIERRA las demás sesiones (A3): al subir tokenVersion, los
    // JWT previos quedan inválidos. Se re-emite el token de la sesión ACTUAL para no
    // autoexpulsar a quien acaba de cambiar su clave (el front lo guarda).
    const passwordHash = await hashPassword(dto.newPassword);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return { ok: true, token: signToken(userId, updated.tokenVersion) };
  }

  /**
   * Destino del OTP de contraseña: primer correo VERIFICADO en orden
   * (institucional → personal); si ninguno está verificado, el `email` primario.
   */
  private resolvePasswordOtpTarget(user: User): string {
    if (user.emailInstitucional && user.emailInstitucionalVerified) {
      return user.emailInstitucional;
    }
    if (user.emailPersonal && user.emailPersonalVerified) {
      return user.emailPersonal;
    }
    return user.email;
  }

  /**
   * Exige que `email` no esté tomado por OTRO usuario como email primario ni como
   * emailInstitucional (ambos `@unique`). 409 si colisiona. `emailPersonal` NO es
   * único, así que no se chequea (la unicidad la impone el email primario recomputado).
   */
  private async assertEmailAvailable(email: string, selfUserId: string): Promise<void> {
    const collision = await this.prisma.user.findFirst({
      where: {
        id: { not: selfUserId },
        OR: [{ email }, { emailInstitucional: email }],
      },
      select: { id: true },
    });
    if (collision) {
      throw new ConflictException('El correo ya está en uso por otro usuario.');
    }
  }

  /** Vista de perfil propio: básicos + correos/verificación + roleKeys (Membership ORG). */
  private toProfile(user: UserWithMemberships): ProfileMe {
    return {
      id: user.id,
      firstName: user.firstName,
      secondName: user.secondName,
      lastName: user.lastName,
      secondLastName: user.secondLastName,
      email: user.email,
      emailInstitucional: user.emailInstitucional,
      emailPersonal: user.emailPersonal,
      // `verified` como boolean = ¿existe timestamp de verificación?
      emailInstitucionalVerified: user.emailInstitucionalVerified !== null,
      emailPersonalVerified: user.emailPersonalVerified !== null,
      pendingEmail: user.pendingEmail,
      pendingEmailKind: user.pendingEmailKind,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isClientUser: user.isClientUser,
      roleKeys: this.collectRoleKeys(user.memberships),
    };
  }

  /** roleKeys ORGANIZATION del usuario, filtradas a claves conocidas (defensivo). */
  private collectRoleKeys(
    memberships: ReadonlyArray<{ roleKey: string; scopeType: string; scopeId: string }>,
  ): RoleKey[] {
    const out: RoleKey[] = [];
    for (const m of memberships) {
      if (m.scopeType !== 'ORGANIZATION' || m.scopeId !== ORG_ID) {
        continue;
      }
      if (isRoleKey(m.roleKey) && !out.includes(m.roleKey)) {
        out.push(m.roleKey);
      }
    }
    return out;
  }

  /** ¿El error es "registro no encontrado" de Prisma (P2025)? */
  private isRecordNotFound(error: unknown): boolean {
    return this.hasPrismaCode(error, 'P2025');
  }

  /** ¿El error es "violación de restricción única" de Prisma (P2002)? */
  private isUniqueViolation(error: unknown): boolean {
    return this.hasPrismaCode(error, 'P2002');
  }

  /** ¿El error trae el `code` de Prisma indicado? */
  private hasPrismaCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}

/** Normaliza un campo opcional: '' (limpiar) → null; resto → tal cual. */
function normalizeOptional(value: string): string | null {
  return value === '' ? null : value;
}
