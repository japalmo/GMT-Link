import { DocumentStatus } from '@prisma/client';

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
  ChecklistTemplateItem,
  ChecklistAnswer,
  Paginated,
} from '@gmt-platform/contracts';

import type { ChecklistAnswer, ChecklistTemplateItem } from '@gmt-platform/contracts';

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
