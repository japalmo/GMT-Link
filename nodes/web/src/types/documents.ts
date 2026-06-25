/**
 * Tipos del frontend para "Mis documentos" (§6-1.5). Reflejan el contrato HTTP
 * de la API (`/documents/me`). El usuario solo ve el estado de revisión; la
 * aprobación/rechazo la realiza un admin revisor y no vive en esta vista.
 */

/** Estado del flujo de revisión de un documento personal. */
export type DocumentStatus = 'BORRADOR' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO';

/** Vista de un documento personal del usuario. */
export interface PersonalDocumentView {
  id: string;
  type: string;
  name: string;
  fileUrl: string;
  /** URL de la versión anterior tras un versionado, o `null`. */
  previousFileUrl: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  status: DocumentStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  /** `true` si el documento vence pronto (umbral resuelto por el backend). */
  expiringSoon: boolean;
  /** Días hasta el vencimiento (puede ser negativo si ya venció), o `null`. */
  daysToExpire: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Campos de metadatos al subir un documento nuevo (el archivo va aparte). */
export interface UploadDocumentFields {
  type: string;
  name: string;
  issuedAt?: string;
  expiresAt?: string;
}

/** Filtros opcionales para `GET /documents/me`. */
export interface DocumentFilters {
  status?: DocumentStatus;
  /** `true` para traer solo los que vencen pronto. */
  expiring?: boolean;
}
