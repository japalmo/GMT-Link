import type { Procedimiento, ServiceFrequency, TaskDataSpec } from '@gmt-platform/contracts';

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



export interface TaskView {
  id: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  projectId: string | null;
  project?: ProjectView;
  parentId?: string | null;
  children?: TaskView[];
  serviceId: string | null;
  service: ServiceView | null;
  assignedToId: string | null;
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
  createdById: string;
  createdBy: { id: string; firstName: string; lastName: string; email: string };
  estimatedPoints: number;
  priority?: string;
  priorityManual?: boolean;
  actualPoints: number | null;
  /** Fecha de inicio planificada, ISO-8601 o null. */
  startDate?: string | null;
  /** Fecha de revisión planificada (#76), ISO-8601 o null. */
  reviewDate: string | null;
  /** Fecha de entrega comprometida (#76), ISO-8601 o null. */
  dueDate: string | null;
  /** Motivo si el gestor rechazó la tarea en revisión (#77). */
  rejectionReason: string | null;
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
  projectId?: string | null;
  parentId?: string | null;
  type?: string;
  priority?: string;
  priorityManual?: boolean;
  serviceId?: string;
  assignedToId?: string;
  /** Fechas de planificación (#76), ISO-8601 (date-only). */
  startDate?: string;
  reviewDate?: string;
  dueDate?: string;
  estimatedPoints?: number;
  recurrence?: string;
  clientUserId?: string;
  dataSpec?: TaskDataSpec | null;
  phaseId?: string | null;
  elementId?: string | null;
  steps?: Array<{
    name: string;
    description?: string;
    priority?: string;
    startDate?: string;
    reviewDate?: string;
    dueDate?: string;
    dataSpec?: TaskDataSpec | null;
    assignedToId?: string;
  }>;
}

/** Entrada para actualizar una tarea (campos editables). */
export interface UpdateTaskInput {
  name?: string;
  description?: string | null;
  assignedToId?: string | null;
  reviewDate?: string | null;
  dueDate?: string | null;
  estimatedPoints?: number;
  actualPoints?: number | null;
  recurrence?: string | null;
  clientUserId?: string | null;
}

/** Entrada para subir un documento de proyecto (metadatos; el archivo va aparte). */
export interface CreateProjectDocumentInput {
  name: string;
  projectId: string;
  serviceId: string;
  documentType: string;
  areaCode: string;
  /** Entregable de una tarea (#77): linkea el documento a la tarea. */
  taskId?: string;
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
  /** Tarea que produjo el entregable (#77), o null para documentos normales. */
  taskId: string | null;
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
