export type AssetType = 'EQUIPO' | 'VEHICULO' | 'MAQUINARIA';
export type VehicleSubtype = 'PICKUP' | 'FURGON' | 'AUTO' | 'AUTOBUS' | 'CAMION';
export type AssetIdentifierType = 'PATENTE' | 'NUMERO_SERIE';
export type AssetStatus =
  | 'DISPONIBLE'
  | 'EN_USO'
  | 'MANTENIMIENTO'
  | 'BAJA'
  | 'DEFECTUOSO'
  | 'NO_DISPONIBLE';
export type DocumentStatus = 'BORRADOR' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO';

export interface AssetView {
  id: string;
  code: string;
  publicToken: string;
  type: AssetType;
  name: string;
  description: string | null;
  status: AssetStatus;
  manufacturer: string | null;
  identifier: string | null;
  identifierType: AssetIdentifierType | null;
  vehicleSubtype: VehicleSubtype | null;
  projectId: string | null;
  assignedToId: string | null;
  inUseById: string | null;
  inUseSince: string | null; // ISO-8601
  metadata: Record<string, unknown> | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  project?: { id: string; name: string } | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  inUseBy?: { id: string; firstName: string; lastName: string } | null;
}

export interface AssetPublicView {
  code: string;
  type: AssetType;
  name: string;
  description: string | null;
  status: AssetStatus;
  manufacturer: string | null;
  vehicleSubtype: VehicleSubtype | null;
  project?: { name: string } | null;
}

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
