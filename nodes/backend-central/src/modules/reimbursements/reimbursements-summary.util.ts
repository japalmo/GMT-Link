import { FinanceStatus } from '@prisma/client';

export interface ReimbursementSummary {
  approvedPendingAmount: number; // suma de APROBADO (aprobado, pendiente de pago)
  pendingApprovalCount: number; // PENDIENTE
  approvedPendingCount: number; // APROBADO
  rankingByWorker: Array<{ userId: string; name: string; total: number }>;
}

/** Conteo por estado (proyectado desde un `groupBy({ by:['status'], _count })`). */
export interface ReimbursementStatusCount {
  status: FinanceStatus;
  count: number;
}

/** Monto por trabajador (proyectado desde `groupBy({ by:['userId'] })`, YA ordenado desc). */
export interface ReimbursementWorkerAmount {
  userId: string;
  total: number;
}

/** Entradas ya agregadas en BD para armar el resumen (spec §5.2). */
export interface ReimbursementSummaryInput {
  statusCounts: readonly ReimbursementStatusCount[];
  approvedPendingAmount: number;
  ranking: readonly ReimbursementWorkerAmount[]; // orden desc por monto (viene del groupBy)
  names: ReadonlyMap<string, string>; // userId → nombre del solicitante
}

/**
 * Ensambla el resumen de reembolsos (cards §5.2) a partir de agregaciones YA
 * calculadas en BD (conteos por estado, suma de APROBADO y ranking por
 * trabajador). No recorre filas: solo mapea los agregados a la forma que consume
 * el front. El ranking conserva el orden de entrada (desc por monto del groupBy).
 */
export function buildReimbursementSummary(input: ReimbursementSummaryInput): ReimbursementSummary {
  const countFor = (status: FinanceStatus): number =>
    input.statusCounts.find((c) => c.status === status)?.count ?? 0;

  return {
    approvedPendingAmount: input.approvedPendingAmount,
    pendingApprovalCount: countFor(FinanceStatus.PENDIENTE),
    approvedPendingCount: countFor(FinanceStatus.APROBADO),
    rankingByWorker: input.ranking.map((r) => ({
      userId: r.userId,
      name: input.names.get(r.userId) ?? r.userId,
      total: r.total,
    })),
  };
}
