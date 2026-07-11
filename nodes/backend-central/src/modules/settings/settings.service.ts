import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserPreferences } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateSettingsDto } from './dto/settings.dto';
import type { NotifyEmailTarget, UserPreferencesView } from './settings.types';

/**
 * Configuración (preferencias) del usuario autenticado (§6-2.3).
 *
 * `UserPreferences` es 1:1 con `User`. Se crea de forma LAZY: un usuario nunca
 * tiene fila hasta que lee o guarda su configuración. `getMine` devuelve los
 * defaults del schema (theme "system", notifyInApp true, notifyEmail false) sin
 * persistir si no existe fila; `updateMine` hace upsert, materializando la fila.
 *
 * Seguridad: el `userId` SIEMPRE llega del controller (sesión), nunca del body.
 * "Solo el propio" es lógica de este service: todas las consultas se scopean por
 * `userId`, así un usuario jamás lee ni edita preferencias ajenas.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Preferencias del propio usuario. Si no existe fila aún, devuelve los
   * defaults del schema (lazy: no persiste hasta el primer PATCH).
   */
  async getMine(userId: string): Promise<UserPreferencesView> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    if (row === null) {
      return DEFAULT_PREFERENCES;
    }
    return toView(row);
  }

  /**
   * Aplica un patch parcial de preferencias del propio usuario (upsert). Solo se
   * tocan los campos presentes en el DTO; los ausentes conservan su valor (o el
   * default del schema en la creación). Retorna las preferencias resultantes.
   */
  async updateMine(userId: string, dto: UpdateSettingsDto): Promise<UserPreferencesView> {
    // El destino de notificaciones por email SOLO puede apuntar a un correo
    // verificado del propio usuario (400 en caso contrario). Se valida antes de
    // persistir para no dejar una preferencia inconsistente.
    if (dto.notifyEmailTarget !== undefined) {
      await this.assertEmailTargetVerified(userId, dto.notifyEmailTarget);
    }

    const row = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.notifyInApp !== undefined ? { notifyInApp: dto.notifyInApp } : {}),
        ...(dto.notifyEmail !== undefined ? { notifyEmail: dto.notifyEmail } : {}),
        ...(dto.notifyEmailTarget !== undefined ? { notifyEmailTarget: dto.notifyEmailTarget } : {}),
      },
      update: {
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.notifyInApp !== undefined ? { notifyInApp: dto.notifyInApp } : {}),
        ...(dto.notifyEmail !== undefined ? { notifyEmail: dto.notifyEmail } : {}),
        ...(dto.notifyEmailTarget !== undefined ? { notifyEmailTarget: dto.notifyEmailTarget } : {}),
      },
    });
    return toView(row);
  }

  /**
   * Exige que `target` apunte a un correo VERIFICADO del usuario (§ verificación).
   * 404 si el usuario ya no existe; 400 si el correo destino no está verificado.
   */
  private async assertEmailTargetVerified(
    userId: string,
    target: NotifyEmailTarget,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailInstitucionalVerified: true, emailPersonalVerified: true },
    });
    if (user === null) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }
    const verified =
      target === 'INSTITUCIONAL'
        ? user.emailInstitucionalVerified !== null
        : user.emailPersonalVerified !== null;
    if (!verified) {
      throw new BadRequestException(
        'El correo destino de notificaciones por email no está verificado.',
      );
    }
  }
}

/** Defaults del schema, devueltos cuando aún no hay fila persistida. */
const DEFAULT_PREFERENCES: UserPreferencesView = {
  theme: 'system',
  notifyInApp: true,
  notifyEmail: false,
  notifyEmailTarget: null,
};

/** Mapea la fila Prisma a la vista pública (theme + canales + destino de email). */
function toView(row: UserPreferences): UserPreferencesView {
  return {
    theme: normalizeTheme(row.theme),
    notifyInApp: row.notifyInApp,
    notifyEmail: row.notifyEmail,
    notifyEmailTarget: normalizeTarget(row.notifyEmailTarget),
  };
}

/**
 * Normaliza el `notifyEmailTarget` persistido (String nullable) a la unión válida.
 * Defensivo: cualquier valor fuera de {INSTITUCIONAL, PERSONAL} cae a null.
 */
function normalizeTarget(value: string | null): NotifyEmailTarget | null {
  if (value === 'INSTITUCIONAL' || value === 'PERSONAL') {
    return value;
  }
  return null;
}

/**
 * Normaliza el `theme` persistido (String en el schema) a la unión válida.
 * Defensivo: si una versión previa guardó un valor fuera de la lista, cae a
 * "system" en vez de propagar un valor inválido al front.
 */
function normalizeTheme(value: string): UserPreferencesView['theme'] {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}
