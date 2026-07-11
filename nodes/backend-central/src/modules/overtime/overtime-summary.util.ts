import { FinanceStatus } from '@prisma/client';

/** Fila mínima para agregar (ya proyectada desde Prisma). */
export interface OvertimeSummaryRow {
  userId: string;
  requesterName: string;
  hours: number | null;
  status: FinanceStatus;
  isDraft: boolean;
  projectId: string | null;
  projectName: string | null;
}

export interface OvertimeSummary {
  pendingCount: number;
  approvedCount: number;
  draftCount: number;
  rankingByWorker: Array<{ userId: string; name: string; hours: number }>;
  byProject: Array<{ projectId: string; name: string; hours: number }>;
}

/** Agrega las HE para las cards (spec §5.2). Orden desc por horas. */
export function summarizeOvertime(rows: readonly OvertimeSummaryRow[]): OvertimeSummary {
  let pendingCount = 0;
  let approvedCount = 0;
  let draftCount = 0;
  const byWorker = new Map<string, { name: string; hours: number }>();
  const byProject = new Map<string, { name: string; hours: number }>();

  for (const r of rows) {
    if (r.isDraft) draftCount += 1;
    else if (r.status === FinanceStatus.PENDIENTE) pendingCount += 1;
    else if (r.status === FinanceStatus.APROBADO) approvedCount += 1;

    const h = r.hours ?? 0;
    const w = byWorker.get(r.userId) ?? { name: r.requesterName, hours: 0 };
    w.hours += h;
    byWorker.set(r.userId, w);

    if (r.projectId) {
      const p = byProject.get(r.projectId) ?? { name: r.projectName ?? r.projectId, hours: 0 };
      p.hours += h;
      byProject.set(r.projectId, p);
    }
  }

  return {
    pendingCount,
    approvedCount,
    draftCount,
    rankingByWorker: [...byWorker.entries()]
      .map(([userId, v]) => ({ userId, name: v.name, hours: v.hours }))
      .sort((a, b) => b.hours - a.hours),
    byProject: [...byProject.entries()]
      .map(([projectId, v]) => ({ projectId, name: v.name, hours: v.hours }))
      .sort((a, b) => b.hours - a.hours),
  };
}
