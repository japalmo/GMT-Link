/**
 * Tipos de activos. Los dominios compartidos (unions + vistas) reexportan
 * `@gmt-platform/contracts` (fuente única, GAP5) para que los consumidores del
 * front importen desde `@/types/assets` sin duplicar definiciones (patrón del
 * repo, ver `@/types/projects`, `@/types/operations`). Aquí se mantienen SOLO
 * los tipos de UI (labels, CreateAssetInput, checklists) y los que aún no viven
 * en contracts (DocumentStatus).
 */
import type {
  AssetType,
  AssetStatus,
  VehicleSubtype,
  AssetIdentifierType,
  AssetView,
  AssetPublicView,
  AssetPublicDocument,
  AssetPublicLastChecklist,
  UpdateAssetInput,
  ChecklistItemType,
  ChecklistItemConfig,
  ChecklistTemplateItem,
  ChecklistSvgPart,
  ChecklistSection,
  ChecklistAnswer,
  UsageCycleView,
  UsageCycleStatus,
  UsageEndKind,
  EndUsageCycleInput,
  UsageCyclePerson,
} from '@gmt-platform/contracts';

export type {
  AssetType,
  AssetStatus,
  VehicleSubtype,
  AssetIdentifierType,
  AssetView,
  AssetPublicView,
  AssetPublicDocument,
  AssetPublicLastChecklist,
  UpdateAssetInput,
  ChecklistItemType,
  ChecklistItemConfig,
  ChecklistTemplateItem,
  ChecklistSvgPart,
  ChecklistSection,
  ChecklistAnswer,
  UsageCycleView,
  UsageCycleStatus,
  UsageEndKind,
  EndUsageCycleInput,
  UsageCyclePerson,
};

/**
 * Resultado de las mutaciones del ciclo de uso (reportar / confirmar / cancelar /
 * terminar): el backend devuelve el activo actualizado junto con el ciclo afectado.
 */
export interface UsageCycleResult {
  asset: AssetView;
  cycle: UsageCycleView;
}

/** Estado de un documento/checklist de activo (local; aún no en contracts). */
export type DocumentStatus = 'BORRADOR' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO';

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
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  reviewedBy?: { firstName: string; lastName: string } | null;
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

export interface CreateAssetInput {
  type: AssetType;
  name: string;
  description?: string;
  manufacturer?: string;
  identifier?: string;
  identifierType?: AssetIdentifierType;
  vehicleSubtype?: VehicleSubtype;
  projectId?: string;
  assignedToId?: string;
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Labels es-CL para tipos y clasificaciones de activos                       */
/* -------------------------------------------------------------------------- */

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  EQUIPO: 'Equipo',
  VEHICULO: 'Vehículo',
  MAQUINARIA: 'Maquinaria',
};

export const VEHICLE_SUBTYPE_LABELS: Record<VehicleSubtype, string> = {
  PICKUP: 'Pickup',
  FURGON: 'Furgón',
  AUTO: 'Auto',
  AUTOBUS: 'Autobús',
  CAMION: 'Camión',
};

export const IDENTIFIER_TYPE_LABELS: Record<AssetIdentifierType, string> = {
  PATENTE: 'Patente',
  NUMERO_SERIE: 'Número de serie',
};

export interface ReviewAssetDocInput {
  status: 'APROBADO' | 'RECHAZADO';
  reason?: string;
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
  /**
   * Secciones (páginas) de la plantilla. Vacío = plantilla de una sola página
   * (comportamiento clásico). Los ítems referencian su sección por `item.section`.
   */
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
  assetId: string;
  templateId: string;
  userId: string;
  answers: ChecklistAnswer[];
  createdAt: string; // ISO-8601
  user?: { firstName: string; lastName: string } | null;
}

export interface CreateAccessoryInput {
  name: string;
  description?: string;
  serialNumber?: string;
}

export interface UpdateAccessoryInput {
  name?: string;
  description?: string;
  serialNumber?: string;
}

export interface UpdateChecklistTemplateInput {
  name: string;
  items: ChecklistTemplateItem[];
  /** Secciones (páginas) de la plantilla. Omitir/[] = plantilla de una sola página. */
  sections?: ChecklistSection[];
}

export interface ReviewChecklistTemplateInput {
  status: 'APROBADO' | 'RECHAZADO';
  reason?: string;
}

/** Firma verificada entrante de un checklist (#68). */
export interface ChecklistSignatureInput {
  method: 'WEBAUTHN' | 'EMAIL_OTP';
  response?: Record<string, unknown>; // WEBAUTHN: aserción de startAuthentication()
  code?: string; // EMAIL_OTP: código de 6 dígitos
}

export interface SubmitChecklistInput {
  templateId: string;
  answers: ChecklistAnswer[];
  signature?: ChecklistSignatureInput;
}

export interface SubmitTelemetryInput {
  latitude: number;
  longitude: number;
  speed: number;
}
