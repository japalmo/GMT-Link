/**
 * Vista pública de una notificación (§6-2.2).
 * Fechas en ISO-8601 (string) para el frontend; `readAt` null = no leída.
 */
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  /** Cuerpo opcional; null si no tiene. */
  body: string | null;
  /** Enlace destino opcional (ruta relativa del front, p. ej. "/perfil/documentos"). */
  link: string | null;
  /** ISO-8601 cuando se marcó leída; null mientras esté sin leer. */
  readAt: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/**
 * Datos para crear una notificación. Lo consumen otros módulos vía
 * `NotificationsService.create(userId, payload)`. El `userId` (destinatario)
 * va aparte, nunca dentro del payload.
 */
export interface CreateNotificationPayload {
  /** Tipo/categoría de la notificación (ej. "document.reviewed"). */
  type: string;
  title: string;
  body?: string;
  link?: string;
}
