export type AssetType = 'EQUIPO' | 'VEHICULO';
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
  type: AssetType;
  name: string;
  description: string | null;
  status: AssetStatus;
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
  project?: { name: string } | null;
  assignedTo?: { firstName: string; lastName: string } | null;
  inUseBy?: { firstName: string; lastName: string } | null;
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
  projectId?: string;
  assignedToId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAssetStatusInput {
  status: AssetStatus;
  description?: string;
}

export interface AssignAssetInput {
  assignedToId: string | null;
}

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
