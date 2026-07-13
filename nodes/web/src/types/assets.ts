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
} from '@gmt-platform/contracts';

export type {
  AssetType,
  AssetStatus,
  VehicleSubtype,
  AssetIdentifierType,
  AssetView,
  AssetPublicView,
};

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

export interface ChecklistTemplateItem {
  id: string;
  type: 'YES_NO' | 'NUMBER' | 'TEXT';
  label: string;
  required: boolean;
}

export interface ChecklistAnswer {
  itemId: string;
  label: string;
  value: string | number | boolean;
}

export interface ChecklistTemplateView {
  id: string;
  assetId: string;
  name: string;
  items: ChecklistTemplateItem[];
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
}

export interface ReviewChecklistTemplateInput {
  status: 'APROBADO' | 'RECHAZADO';
  reason?: string;
}

export interface SubmitChecklistInput {
  templateId: string;
  answers: ChecklistAnswer[];
}

export interface SubmitTelemetryInput {
  latitude: number;
  longitude: number;
  speed: number;
}
