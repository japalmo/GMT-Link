import { Injectable, NotFoundException } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateNotificationPayload, NotificationView } from './notifications.types';

/**
 * Notificaciones in-app del usuario (§6-2.2).
 *
 * `create()` es reutilizable por otros módulos (p. ej. `DocumentsService` la
 * dispara al aprobar/rechazar un documento). Las LECTURAS siempre reciben el
 * `userId` de la sesión (lo deriva el controller): "solo el dueño" es lógica de
 * este service — un usuario nunca ve ni marca notificaciones ajenas.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una notificación para `userId` (destinatario). Reutilizable desde otros
   * módulos. No falla si `body`/`link` vienen vacíos: se guardan como null.
   *
   * Respeta la preferencia del DESTINATARIO (§6-2.3, DoD "cambios aplican"): si
   * sus `UserPreferences.notifyInApp === false`, NO crea la notificación y
   * retorna `null` (no-op tipado). Sin preferencias guardadas → default true
   * (se crea). Los llamadores que no usan el retorno (p. ej. `DocumentsService`)
   * siguen funcionando sin cambios.
   */
  async create(
    userId: string,
    payload: CreateNotificationPayload,
  ): Promise<NotificationView | null> {
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { notifyInApp: true },
    });
    // Sin preferencias → default true (se crea). Solo se omite si está en false.
    if (prefs !== null && prefs.notifyInApp === false) {
      return null;
    }

    const row = await this.prisma.notification.create({
      data: {
        userId,
        type: payload.type,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
      },
    });
    return toView(row);
  }

  /**
   * Lista las notificaciones propias (orden createdAt desc). Con `unreadOnly`
   * filtra solo las no leídas (`readAt` null).
   */
  async listMine(userId: string, unreadOnly: boolean): Promise<NotificationView[]> {
    const rows = await this.prisma.notification.findMany({
      where: unreadOnly ? { userId, readAt: null } : { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  /** Cantidad de notificaciones propias sin leer. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  /**
   * Marca como leída una notificación propia (fija `readAt=now`). 404 si no
   * existe o no pertenece al usuario (no revela existencia de ajenas).
   * Idempotente: re-marcar una ya leída no cambia el `readAt` original.
   */
  async markRead(userId: string, id: string): Promise<NotificationView> {
    const existing = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException('La notificación no existe.');
    }
    if (existing.readAt !== null) {
      return toView(existing);
    }
    const row = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return toView(row);
  }

  /**
   * Marca como leídas todas las no leídas del usuario. Retorna cuántas se
   * actualizaron.
   */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}

/** Mapea la fila Prisma a la vista pública (fechas a ISO-8601). */
function toView(row: Notification): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
