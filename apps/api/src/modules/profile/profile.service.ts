import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ORG_ID } from '../../common/org.constant';
import { isRoleKey } from '../../common/role-keys';
import type { RoleKey } from '../../common/role-keys';
import { FirebaseService } from '../../auth/firebase.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordResponse, ProfileMe } from './profile.types';

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
 * secondLastName?, avatarUrl?. NO se permite cambiar email (identidad Firebase →
 * solo lectura), status, roles ni points: el `data` de Prisma se arma a mano con
 * solo los campos del DTO, así que esos campos jamás se escriben desde aquí.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
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
   * Cambia la contraseña del PROPIO usuario en Firebase. Recibe el `firebaseUid`
   * de la sesión (no del body). No toca Postgres: la contraseña vive solo en
   * Firebase (§2). El control de "hay firebaseUid" lo hace el controller (401).
   */
  async changePassword(firebaseUid: string, newPassword: string): Promise<ChangePasswordResponse> {
    await this.firebase.setPassword(firebaseUid, newPassword);
    return { ok: true };
  }

  /** Vista de perfil propio: básicos + roleKeys (Membership ORG del propio usuario). */
  private toProfile(user: UserWithMemberships): ProfileMe {
    return {
      id: user.id,
      firstName: user.firstName,
      secondName: user.secondName,
      lastName: user.lastName,
      secondLastName: user.secondLastName,
      email: user.email,
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
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2025'
    );
  }
}

/** Normaliza un campo opcional: '' (limpiar) → null; resto → tal cual. */
function normalizeOptional(value: string): string | null {
  return value === '' ? null : value;
}
