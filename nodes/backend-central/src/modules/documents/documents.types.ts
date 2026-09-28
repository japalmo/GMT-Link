import type { DocumentStatus } from '@prisma/client';

/**
 * Vista de un documento personal (§6-1.5 "Mis documentos").
 * Fechas en ISO-8601 (string) para el frontend. `expiringSoon` lo deriva el
 * service (vence en <= 30 días) para que la UI marque el vencimiento sin
 * recomputar; `daysToExpire` es informativo (null si no tiene vencimiento).
 */
export interface PersonalDocumentView {
  id: string;
  type: string;
  name: string;
  /**
   * CLAVE de storage (documentos nuevos, Fase 1B) o URL absoluta legada. NO es
   * navegable directamente: la URL fresca la entrega `GET /documents/:id/file-url`.
   *
   * `null` = documento "placeholder": existe el registro con su fecha de
   * vencimiento, pero el archivo todavía no se sube. La UI tiene que ofrecer
   * subirlo en vez de un botón de descarga que no puede funcionar.
   */
  fileUrl: string | null;
  /**
   * Versión anterior conservada al subir una nueva (ApprovalWorkflow); null si
   * nunca se versionó. Misma naturaleza que `fileUrl` (clave o URL legada): la
   * URL fresca se pide con `GET /documents/:id/file-url?previous=true`.
   */
  previousFileUrl: string | null;
  /** ISO-8601 o null. */
  issuedAt: string | null;
  /** ISO-8601 o null. */
  expiresAt: string | null;
  status: DocumentStatus;
  reviewedById: string | null;
  /** ISO-8601 o null. */
  reviewedAt: string | null;
  /** Vence en <= 30 días desde ahora (false si ya venció o no tiene vencimiento). */
  expiringSoon: boolean;
  /** Días hasta el vencimiento (negativo si ya venció); null si no tiene vencimiento. */
  daysToExpire: number | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}
