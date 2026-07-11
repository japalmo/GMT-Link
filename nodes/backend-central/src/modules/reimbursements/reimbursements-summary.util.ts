import { FinanceStatus } from '@prisma/client';

export interface ReimbursementSummaryRow {
  userId: string;
  requesterName: string;
  amount: number;
  status: FinanceStatus;
}

export interface ReimbursementSummary {
  approvedPendingAmount: number; // suma de APROBADO (aprobado, pendiente de pago)
  pendingApprovalCount: number; // PENDIENTE
  approvedPendingCount: number; // APROBADO
  rankingByWorker: Array<{ userId: string; name: string; total: number }>;
}

/** Agrega reembolsos para las cards (spec §5.2). Ranking = monto APROBADO por trabajador, desc. */
export function summarizeReimbursements(
  rows: readonly ReimbursementSummaryRow[],
): ReimbursementSummary {
  let approvedPendingAmount = 0;
  let pendingApprovalCount = 0;
  let approvedPendingCount = 0;
  const byWorker = new Map<string, { name: string; total: number }>();

  for (const r of rows) {
    if (r.status === FinanceStatus.PENDIENTE) pendingApprovalCount += 1;
    if (r.status === FinanceStatus.APROBADO) {
      approvedPendingCount += 1;
      approvedPendingAmount += r.amount;
      const w = byWorker.get(r.userId) ?? { name: r.requesterName, total: 0 };
      w.total += r.amount;
      byWorker.set(r.userId, w);
    }
  }

  return {
    approvedPendingAmount,
    pendingApprovalCount,
    approvedPendingCount,
    rankingByWorker: [...byWorker.entries()]
      .map(([userId, v]) => ({ userId, name: v.name, total: v.total }))
      .sort((a, b) => b.total - a.total),
  };
}
