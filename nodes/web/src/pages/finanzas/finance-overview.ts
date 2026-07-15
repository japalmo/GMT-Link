import type {
  FinanceProjectRef,
  FinanceRow,
  OverviewFilters,
  OvertimeView,
  ReimbursementView,
} from '@/types/finance';

/**
 * Funciones puras de la Vista general (§5.2/§5.3): cierre mensual día 20,
 * unificación de reembolsos + HE en filas homogéneas, filtrado, agregación de
 * métricas y rankings. Sin JSX ni efectos → testeables con vitest. La agregación
 * es CLIENT-SIDE: se computa a partir de las listas ya cargadas.
 */

/**
 * Mes de agrupación de una fecha con cierre el día 20 (spec §2.4): si el día del
 * mes es ≤ 20, cuenta como su mes calendario; si es > 20, cuenta como el mes
 * siguiente. Devuelve "YYYY-MM". Usa UTC para ser estable entre zonas horarias.
 */
export function overtimeMonth(dateIso: string): string {
  const d = new Date(dateIso);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth(); // 0-11
  if (d.getUTCDate() > 20) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function requesterName(r: { firstName: string; lastName: string } | undefined): string {
  return r ? `${r.firstName} ${r.lastName}` : '—';
}

/**
 * Unifica reembolsos + HE en filas homogéneas para la Vista general. Las HE traen
 * solo `projectId`/`projectOther`; el nombre/cliente se hidrata contra `projects`
 * (client-side). Los reembolsos NO llevan proyecto/cliente (resolución #4).
 */
export function toFinanceRows(
  reimbursements: ReimbursementView[],
  overtime: OvertimeView[],
  projects: FinanceProjectRef[] = [],
): FinanceRow[] {
  const projectById = new Map<string, FinanceProjectRef>();
  for (const p of projects) projectById.set(p.id, p);

  const rRows: FinanceRow[] = reimbursements.map((r) => ({
    id: r.id,
    kind: 'REEMBOLSO',
    date: r.date,
    status: r.status,
    isDraft: false,
    amount: r.amount,
    hours: null,
    description: r.concept,
    category: r.category,
    requesterId: r.requester?.id ?? r.userId,
    requesterName: requesterName(r.requester),
    projectId: null,
    projectName: null,
    clientId: null,
    clientName: null,
    printed: r.printed,
    receiptUrl: r.receiptUrl,
    // El desglose de horario/horas no aplica a reembolsos.
    startTime: null,
    endTime: null,
    totalHours: null,
    regularHours: null,
    shiftLabel: null,
  }));

  const oRows: FinanceRow[] = overtime.map((o) => {
    const proj = o.projectId ? projectById.get(o.projectId) : undefined;
    return {
      id: o.id,
      kind: 'HORA_EXTRA',
      date: o.date,
      status: o.status,
      isDraft: o.isDraft,
      amount: null,
      hours: o.hours,
      description: o.reason ?? '—',
      category: null,
      requesterId: o.requester?.id ?? o.userId,
      requesterName: requesterName(o.requester),
      projectId: o.projectId,
      projectName: proj?.name ?? o.projectOther ?? null,
      clientId: proj?.clientId ?? null,
      clientName: proj?.clientName ?? null,
      printed: false,
      receiptUrl: null,
      // Desglose de horas extra: inicio/fin, total, turno normal y turno del día.
      startTime: o.startTime,
      endTime: o.endTime,
      totalHours: o.totalHours,
      regularHours: o.regularHours,
      shiftLabel: o.shiftLabel,
    };
  });

  return [...rRows, ...oRows];
}

/** Devuelve la porción "YYYY-MM-DD" de un ISO para comparaciones de fecha. */
function dayOf(dateIso: string): string {
  return dateIso.slice(0, 10);
}

/**
 * Aplica los filtros de la tabla histórica y ordena por fecha (§5.3). El filtro
 * por proyecto/cliente aplica SOLO a HE: los reembolsos nunca se excluyen por él
 * (resolución #4).
 */
export function filterRows(rows: FinanceRow[], f: OverviewFilters): FinanceRow[] {
  const out = rows.filter((r) => {
    if (f.requesterId && r.requesterId !== f.requesterId) return false;
    if (f.projectId && r.kind === 'HORA_EXTRA' && r.projectId !== f.projectId) return false;
    if (f.clientId && r.kind === 'HORA_EXTRA' && r.clientId !== f.clientId) return false;

    const day = dayOf(r.date);
    switch (f.dateMode) {
      case 'before':
        if (f.dateFrom && day >= f.dateFrom) return false;
        break;
      case 'after':
        if (f.dateFrom && day <= f.dateFrom) return false;
        break;
      case 'exact':
        if (f.dateFrom && day !== f.dateFrom) return false;
        break;
      case 'between':
        if (f.dateFrom && day < f.dateFrom) return false;
        if (f.dateTo && day > f.dateTo) return false;
        break;
      case 'month':
        if (f.month && overtimeMonth(r.date) !== f.month) return false;
        break;
      case 'none':
      default:
        break;
    }
    return true;
  });

  return out.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    return f.order === 'asc' ? cmp : -cmp;
  });
}

/** Métricas de las cards superiores (§5.2). */
export interface OverviewAggregate {
  /** HE en estado PENDIENTE (excluye borradores: un borrador no es aprobable). */
  overtimePendingCount: number;
  /** Suma CLP de reembolsos APROBADOS (aprobados pendientes de pago). */
  reimbursementApprovedUnpaid: number;
  /** HE APROBADAS (para la card de 2 estados pendientes/aprobadas). */
  overtimeApprovedCount: number;
  /** Reembolsos PENDIENTE de aprobación (cantidad). */
  reimbursementPendingCount: number;
}

export function aggregate(rows: FinanceRow[]): OverviewAggregate {
  let overtimePendingCount = 0;
  let overtimeApprovedCount = 0;
  let reimbursementApprovedUnpaid = 0;
  let reimbursementPendingCount = 0;
  for (const r of rows) {
    if (r.kind === 'HORA_EXTRA') {
      if (r.status === 'PENDIENTE' && !r.isDraft) overtimePendingCount += 1;
      if (r.status === 'APROBADO') overtimeApprovedCount += 1;
    } else {
      if (r.status === 'APROBADO') reimbursementApprovedUnpaid += r.amount ?? 0;
      if (r.status === 'PENDIENTE') reimbursementPendingCount += 1;
    }
  }
  return {
    overtimePendingCount,
    overtimeApprovedCount,
    reimbursementApprovedUnpaid,
    reimbursementPendingCount,
  };
}

/** Una entrada de ranking (trabajador o proyecto). */
export interface RankEntry {
  key: string;
  label: string;
  value: number;
}

type RankMetric = 'reimbursement' | 'overtime';

function rank(
  rows: FinanceRow[],
  metric: RankMetric,
  keyFn: (r: FinanceRow) => { key: string; label: string } | null,
): RankEntry[] {
  const map = new Map<string, RankEntry>();
  for (const r of rows) {
    if (metric === 'reimbursement' && r.kind !== 'REEMBOLSO') continue;
    if (metric === 'overtime' && r.kind !== 'HORA_EXTRA') continue;
    // Un gasto/HE rechazado no representa consumo real: fuera del ranking (§5.2).
    if (r.status === 'RECHAZADO') continue;
    const k = keyFn(r);
    if (!k) continue;
    const inc = metric === 'reimbursement' ? r.amount ?? 0 : r.hours ?? 0;
    const prev = map.get(k.key);
    if (prev) prev.value += inc;
    else map.set(k.key, { key: k.key, label: k.label, value: inc });
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/** Ranking de trabajadores por total de reembolso u horas (§5.2). */
export function rankByWorker(rows: FinanceRow[], metric: RankMetric): RankEntry[] {
  return rank(rows, metric, (r) => ({ key: r.requesterId, label: r.requesterName }));
}

/** Ranking de proyectos por total de reembolso u horas (§5.2). Solo aplica a HE
 * (los reembolsos no llevan proyecto), por lo que `metric='reimbursement'` da
 * vacío. */
export function rankByProject(rows: FinanceRow[], metric: RankMetric): RankEntry[] {
  return rank(rows, metric, (r) =>
    r.projectId || r.projectName
      ? { key: r.projectId ?? r.projectName ?? 'otro', label: r.projectName ?? 'Otro' }
      : null,
  );
}
