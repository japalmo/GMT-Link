import type { Procedimiento, ServiceFrequency } from '@gmt-platform/contracts';

export interface ProjectView {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  clientId: string;
  kpis: Record<string, unknown>;
  createdAt: string;
  department?: { id: string; name: string; code: string };
  client?: { id: string; name: string; code: string };
  services?: ServiceView[];
}

export interface ServiceView {
  id: string;
  code: string;
  name: string;
  projectId: string;
  docCodingConfig: Record<string, unknown>;
  serviceTypeId?: string | null;
  frequency?: ServiceFrequency | null;
  /** Tipo de servicio embebido (lo incluye `getProject`); solo lo que muestra la UI. */
  serviceType?: {
    id: string;
    code: string;
    name: string;
    procedures: Procedimiento[];
  } | null;
}

export type TaskStatus = 'PENDIENTE' | 'EN_PROGRESO' | 'REVISADO' | 'COMPLETADO';

export interface TaskTimeLogView {
  id: string;
  taskId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  createdAt: string;
}

/** Especificación del entregable/producto de una tarea (type + label conocidos). */
export interface TaskDataSpec {
  type: string;
  label?: string;
  [key: string]: unknown;
}

export interface TaskView {
  id: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  projectId: string;
  project: ProjectView;
  serviceId: string | null;
  service: ServiceView | null;
  assignedToId: string | null;
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
  createdById: string;
  createdBy: { id: string; firstName: string; lastName: string; email: string };
  estimatedPoints: number;
  actualPoints: number | null;
  recurrence: string | null;
  clientUserId: string | null;
  clientUser: { id: string; firstName: string; lastName: string; email: string } | null;
  timeLogs?: TaskTimeLogView[];
  dataSpec?: TaskDataSpec | null;
  phaseId?: string | null;
  elementId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Entrada para crear una tarea (espejo del DTO backend y de api.createTask). */
export interface CreateTaskInput {
  name: string;
  description?: string;
  projectId: string;
  serviceId?: string;
  assignedToId?: string;
  estimatedPoints?: number;
  recurrence?: string;
  clientUserId?: string;
  dataSpec?: TaskDataSpec | null;
  phaseId?: string | null;
  elementId?: string | null;
}

/** Entrada para actualizar una tarea (campos editables). */
export interface UpdateTaskInput {
  name?: string;
  description?: string;
  assignedToId?: string;
  estimatedPoints?: number;
  actualPoints?: number;
  recurrence?: string;
  clientUserId?: string;
}

/** Entrada para subir un documento de proyecto (metadatos; el archivo va aparte). */
export interface CreateProjectDocumentInput {
  name: string;
  projectId: string;
  serviceId: string;
  documentType: string;
  areaCode: string;
}

export type ProjectDocumentStatus = 'BORRADOR' | 'PENDIENTE_QA' | 'PENDIENTE_CLIENTE' | 'APROBADO' | 'RECHAZADO';

export interface ProjectDocumentView {
  id: string;
  name: string;
  code: string;
  fileUrl: string;
  fileHash: string | null;
  status: ProjectDocumentStatus;
  version: number;
  previousFileUrl: string | null;
  projectId: string;
  project: ProjectView;
  serviceId: string;
  service: ServiceView;
  ownerId: string;
  owner: { id: string; firstName: string; lastName: string; email: string };
  qaSignerId: string | null;
  qaSigner: { id: string; firstName: string; lastName: string } | null;
  qaSignedAt: string | null;
  clientSignerId: string | null;
  clientSigner: { id: string; firstName: string; lastName: string } | null;
  clientSignedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
