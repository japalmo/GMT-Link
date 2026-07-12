import { FinanceStatus } from '@prisma/client';

export interface OvertimeSummary {
  pendingCount: number;
  approvedCount: number;
  draftCount: number;
  rankingByWorker: Array<{ userId: string; name: string; hours: number }>;
  byProject: Array<{ projectId: string; name: string; hours: number }>;
}

/** Conteo por estado + borrador (proyectado desde `groupBy({ by:['status','isDraft'], _count })`). */
export interface OvertimeStatusCount {
  status: FinanceStatus;
  isDraft: boolean;
  count: number;
}

/** Horas por trabajador (proyectado desde `groupBy({ by:['userId'] })`, YA ordenado desc). */
export interface OvertimeWorkerHours {
  userId: string;
  hours: number;
}

/** Horas por proyecto (proyectado desde `groupBy({ by:['projectId'] })`, YA ordenado desc). */
export interface OvertimeProjectHours {
  projectId: string;
  hours: number;
}

/** Entradas ya agregadas en BD para armar el resumen (spec §5.2). */
export interface OvertimeSummaryInput {
  statusCounts: readonly OvertimeStatusCount[];
  ranking: readonly OvertimeWorkerHours[]; // orden desc por horas (viene del groupBy)
  byProject: readonly OvertimeProjectHours[]; // orden desc por horas (viene del groupBy)
  workerNames: ReadonlyMap<string, string>; // userId → nombre del solicitante
  projectNames: ReadonlyMap<string, string>; // projectId → nombre del proyecto
}

/**
 * Ensambla el resumen de horas extra (cards §5.2) a partir de agregaciones YA
 * calculadas en BD. Un borrador NUNCA cuenta como pendiente/aprobado (se prioriza
 * `isDraft`, igual que la lógica en memoria previa). El ranking por trabajador y el
 * desglose por proyecto conservan el orden de entrada (desc por horas del groupBy).
 */
export function buildOvertimeSummary(input: OvertimeSummaryInput): OvertimeSummary {
  let pendingCount = 0;
  let approvedCount = 0;
  let draftCount = 0;

  for (const c of input.statusCounts) {
    if (c.isDraft) draftCount += c.count;
    else if (c.status === FinanceStatus.PENDIENTE) pendingCount += c.count;
    else if (c.status === FinanceStatus.APROBADO) approvedCount += c.count;
  }

  return {
    pendingCount,
    approvedCount,
    draftCount,
    rankingByWorker: input.ranking.map((r) => ({
      userId: r.userId,
      name: input.workerNames.get(r.userId) ?? r.userId,
      hours: r.hours,
    })),
    byProject: input.byProject.map((p) => ({
      projectId: p.projectId,
      name: input.projectNames.get(p.projectId) ?? p.projectId,
      hours: p.hours,
    })),
  };
}
