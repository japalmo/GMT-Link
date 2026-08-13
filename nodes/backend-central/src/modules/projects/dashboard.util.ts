import type {
  DashboardMetrics,
  DashboardCurvePoint,
  DashboardGroup,
  DashboardGrouping,
  ProjectDashboard,
} from '@gmt-platform/contracts';

/**
 * Cálculo del Dashboard de producción a partir de las actividades (Tasks) de un
 * proyecto. Todo es PURO (sin Prisma) para poder testearlo con datos fijos.
 *
 * Ponderación: se usa `weight` (= `estimatedPoints`). Si NINGUNA actividad del
 * conjunto tiene peso (>0), se cae a peso igual (1 por actividad). Así respeta la
 * ponderación cuando existe y no rompe cuando no.
 *
 * Curva real: acumulado del peso completado en el tiempo, por `completedAt`.
 * Curva proyectada: acumulado del peso planificado en el tiempo, por `dueDate`.
 * Término estimado: por el ritmo real observado (velocidad = peso/día). La lógica
 * de proyección queda encapsulada en `estimateEndDate` para poder mejorarla luego.
 */

const COMPLETED_STATUS = 'COMPLETADO';
const MS_DAY = 86_400_000;

/** Una actividad como la necesita el cálculo (subconjunto de Task). */
export interface DashboardActivity {
  groupId: string; // id del servicio (o fase)
  groupName: string;
  status: string; // TaskStatus
  weight: number; // estimatedPoints (crudo; puede ser 0)
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
}

function dayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function diffDays(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / MS_DAY;
}

/** Peso efectivo de cada actividad: `estimatedPoints`, o 1 si el conjunto no tiene pesos. */
function effectiveWeights(acts: DashboardActivity[]): Map<DashboardActivity, number> {
  const anyWeight = acts.some((a) => a.weight > 0);
  const m = new Map<DashboardActivity, number>();
  for (const a of acts) m.set(a, anyWeight ? Math.max(a.weight, 0) : 1);
  return m;
}

/**
 * Término estimado por ritmo real: velocidad = peso completado / días transcurridos
 * desde el inicio; los días restantes = peso pendiente / velocidad. Devuelve null
 * si aún no hay avance (no se puede proyectar un ritmo).
 */
function estimateEndDate(
  now: Date,
  timelineStart: Date | null,
  totalWeight: number,
  completedWeight: number,
): Date | null {
  if (completedWeight <= 0 || totalWeight <= 0 || !timelineStart) return null;
  const elapsed = Math.max(diffDays(now, timelineStart), 0.5); // piso para no dividir por ~0
  const velocity = completedWeight / elapsed; // peso por día
  if (velocity <= 0) return null;
  const remaining = totalWeight - completedWeight;
  if (remaining <= 0) return now; // ya está todo
  const remainingDays = remaining / velocity;
  return new Date(now.getTime() + remainingDays * MS_DAY);
}

/** Interpola el % de una curva a una fecha dada (para el "avance proyectado a hoy"). */
function curveValueAt(curve: DashboardCurvePoint[], now: Date): number {
  if (curve.length === 0) return 0;
  const t = now.getTime();
  let prev = curve[0]!;
  if (t <= new Date(prev.date).getTime()) return prev.progress;
  for (let i = 1; i < curve.length; i++) {
    const cur = curve[i]!;
    const ct = new Date(cur.date).getTime();
    if (t <= ct) {
      const pt = new Date(prev.date).getTime();
      const frac = ct === pt ? 1 : (t - pt) / (ct - pt);
      return prev.progress + (cur.progress - prev.progress) * frac;
    }
    prev = cur;
  }
  return curve[curve.length - 1]!.progress;
}

/** Acumula peso por día ordenado por `dateOf`, devolviendo la curva 0..100. */
function cumulativeCurve(
  acts: DashboardActivity[],
  weights: Map<DashboardActivity, number>,
  totalWeight: number,
  dateOf: (a: DashboardActivity) => Date | null,
  start: Date | null,
): DashboardCurvePoint[] {
  const dated = acts
    .map((a) => ({ a, d: dateOf(a) }))
    .filter((x): x is { a: DashboardActivity; d: Date } => x.d !== null)
    .sort((x, y) => x.d.getTime() - y.d.getTime());
  if (dated.length === 0 || totalWeight <= 0) return [];
  const points: DashboardCurvePoint[] = [];
  const startDay = start ?? dated[0]!.d;
  points.push({ date: dayISO(startDay), progress: 0 });
  let acc = 0;
  const byDay = new Map<string, number>();
  for (const { a, d } of dated) {
    const key = dayISO(d);
    byDay.set(key, (byDay.get(key) ?? 0) + (weights.get(a) ?? 0));
  }
  for (const [day, w] of [...byDay.entries()].sort()) {
    acc += w;
    points.push({ date: day, progress: Math.round((acc / totalWeight) * 1000) / 10 });
  }
  return points;
}

/** Indicadores de un conjunto de actividades. */
export function computeMetrics(acts: DashboardActivity[], now: Date): DashboardMetrics {
  const total = acts.length;
  const completedActs = acts.filter((a) => a.status === COMPLETED_STATUS);
  const completed = completedActs.length;
  const weights = effectiveWeights(acts);
  const totalWeight = acts.reduce((s, a) => s + (weights.get(a) ?? 0), 0);
  const completedWeight = completedActs.reduce((s, a) => s + (weights.get(a) ?? 0), 0);

  // Inicio de la línea de tiempo: primera fecha relevante (inicio planificado,
  // vencimiento o completado más temprano).
  const dates: number[] = [];
  for (const a of acts) {
    for (const d of [a.startDate, a.dueDate, a.completedAt]) if (d) dates.push(d.getTime());
  }
  const timelineStart = dates.length ? new Date(Math.min(...dates)) : null;

  const realCurve = cumulativeCurve(acts, weights, totalWeight, (a) => a.completedAt, timelineStart);
  const projectedCurve = cumulativeCurve(acts, weights, totalWeight, (a) => a.dueDate, timelineStart);

  const dueDates = acts.map((a) => a.dueDate).filter((d): d is Date => d !== null);
  const programEnd = dueDates.length
    ? new Date(Math.max(...dueDates.map((d) => d.getTime())))
    : null;
  const estEnd = estimateEndDate(now, timelineStart, totalWeight, completedWeight);
  const deviationDays =
    estEnd && programEnd ? Math.round(diffDays(estEnd, programEnd)) : null;

  return {
    total,
    completed,
    inProgress: total - completed,
    realProgress: totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 1000) / 10 : 0,
    projectedProgress: Math.round(curveValueAt(projectedCurve, now) * 10) / 10,
    realCurve,
    projectedCurve,
    programEndDate: programEnd ? dayISO(programEnd) : null,
    estimatedEndDate: estEnd ? dayISO(estEnd) : null,
    deviationDays,
  };
}

/** Arma el Dashboard completo: TOTAL + un grupo por servicio (o fase). */
export function computeProjectDashboard(
  projectId: string,
  projectName: string,
  grouping: DashboardGrouping,
  activities: DashboardActivity[],
  now: Date,
): ProjectDashboard {
  const byGroup = new Map<string, DashboardActivity[]>();
  for (const a of activities) {
    const arr = byGroup.get(a.groupId);
    if (arr) arr.push(a);
    else byGroup.set(a.groupId, [a]);
  }
  const groups: DashboardGroup[] = [...byGroup.entries()]
    .map(([id, acts]) => ({ id, name: acts[0]!.groupName, metrics: computeMetrics(acts, now) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return {
    projectId,
    projectName,
    grouping,
    total: computeMetrics(activities, now),
    groups,
    generatedAt: now.toISOString(),
  };
}
