import { AssetType, AssetStatus, DocumentStatus } from '@prisma/client';

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
  items: Record<string, unknown>[];
  status: DocumentStatus;
  previousItems: Record<string, unknown>[] | null;
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
  answers: Record<string, unknown>[];
  createdAt: string; // ISO-8601
  user?: { firstName: string; lastName: string } | null;
}
