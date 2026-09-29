import type { OrigenChecklist } from './checklist-origen.util';
import { DocumentStatus } from '@prisma/client';
import type { AssetType as AssetTypeValue } from '@gmt-platform/contracts';

/**
 * Los tipos de dominio de activos (unions + vistas) viven en
 * `@gmt-platform/contracts` (fuente única, GAP5). Se re-exportan aquí para que
 * `assets.service.ts` / controllers sigan importando desde `./assets.types` sin
 * cambios. Los enums Prisma (`row.type`, `AssetStatus.MANTENIMIENTO`, …) son
 * string-valued y por tanto asignables a estos unions.
 */
export type {
  AssetType,
  AssetStatus,
  VehicleSubtype,
  AssetIdentifierType,
  AssetView,
  AssetPublicView,
  AssetPublicDocument,
  AssetPublicLastChecklist,
  ChecklistItemType,
  ChecklistItemConfig,
  ChecklistSvgPart,
  ChecklistTemplateItem,
  ChecklistSection,
  ChecklistAnswer,
  Paginated,
} from '@gmt-platform/contracts';

import type { ChecklistAnswer, ChecklistSection, ChecklistTemplateItem } from '@gmt-platform/contracts';

export interface AssetDocumentView {
  id: string;
  assetId: string;
  name: string;
  type: string;
  fileUrl: string;
  status: DocumentStatus;
  previousFileUrl: string | null;
  reviewedById: string | null;
  reviewedAt: string | null; // ISO-8601
  expirationDate: string | null; // ISO-8601
  /** ¿Se muestra en la ficha pública (accesible por QR)? Lo controla el detalle. */
  visibleInFiche: boolean;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  reviewedBy?: { firstName: string; lastName: string } | null;
}

/**
 * Mínimo que el formulario de checklist independiente necesita del activo, tras
 * resolver el token público. NO expone la ficha completa: solo lo justo para
 * cargar la plantilla y rotular el formulario.
 */
export interface AssetPublicResolved {
  id: string;
  code: string;
  name: string;
  type: AssetTypeValue;
  /** Patente (vehículos) o número de serie. */
  identifier: string | null;
}

export interface AssetHistoryEntryView {
  id: string;
  assetId: string;
  type: string;
  description: string;
  actorId: string | null;
  createdAt: string; // ISO-8601
  actor?: { firstName: string; lastName: string } | null;
}

export interface AssetAccessoryView {
  id: string;
  assetId: string;
  name: string;
  description: string | null;
  serialNumber: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface ChecklistTemplateView {
  id: string;
  assetId: string;
  name: string;
  items: ChecklistTemplateItem[];
  /** Secciones (páginas) del formulario; `[]` si la plantilla no define ninguna. */
  sections: ChecklistSection[];
  status: DocumentStatus;
  previousItems: ChecklistTemplateItem[] | null;
  reviewedById: string | null;
  reviewedAt: string | null; // ISO-8601
  rejectionReason: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  reviewedBy?: { firstName: string; lastName: string } | null;
}

export interface ChecklistSubmissionView {
  id: string;
  /**
   * ¿Salió el correo con el PDF adjunto?
   *
   * Opcional porque solo lo informa el envío que manda correo. Que sea `false`
   * NO significa que el checklist se haya perdido: quedó guardado igual. La
   * pantalla tiene que decirlo así y ofrecer la descarga, en vez de afirmar un
   * envío que no ocurrió.
   */
  correoEnviado?: boolean;
  /** Nombre que declaró quien lo llenó desde el enlace público, sin cuenta. */
  declaredName?: string | null;
  assetId: string;
  templateId: string;
  /** `null` en los checklists importados de la planilla: no tienen usuario. */
  userId: string | null;
  answers: ChecklistAnswer[];
  createdAt: string; // ISO-8601
  user?: { firstName: string; lastName: string } | null;
  /** `'SHEETS'` si vino de la planilla; ausente si se hizo en GMT Link. */
  externalSource?: string | null;
  /**
   * Quién lo llenó según la planilla, cuando no hay usuario. Se muestra como
   * dato informativo y con su origen a la vista: no es una firma de la
   * plataforma y la pantalla no debe presentarlo como si lo fuera.
   */
  externalAuthor?: string | null;
  /**
   * Derivado de `userId` y `externalSource`: GMT_LINK (con sesión), PLANILLA
   * (importado) o SIN_VERIFICAR (desde el QR sin cuenta).
   */
  origen: OrigenChecklist;
  /** Nombre a mostrar; `null` si no hay ninguno. */
  autor: string | null;
}
