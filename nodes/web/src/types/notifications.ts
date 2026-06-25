/**
 * Tipos del frontend para las Notificaciones in-app (§6-2.2). Reflejan el
 * contrato HTTP de la API (`/notifications`). Las fechas viajan como string
 * ISO-8601; `readAt` null = no leída. `link` es una ruta relativa del front.
 */

/** Vista pública de una notificación. */
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
