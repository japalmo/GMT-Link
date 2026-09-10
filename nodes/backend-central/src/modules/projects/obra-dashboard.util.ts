/**
 * Dashboard de avance de OBRA (proyectos OBRAS_CIVILES).
 *
 * Distinto del dashboard de producción (`dashboard.util.ts`), que mide avance
 * BINARIO ponderado por esfuerzo (actividad completada o no). Acá el avance es
 * FÍSICO y continuo: 48 de 135 dados, 720 de 1.000 ml de zanja. Es la métrica
 * contractual de la carta Gantt y la que se proyecta en faena.
 *
 * Todo es PURO (sin Prisma) para poder probarlo con datos fijos.
 *
 * Ponderación: cada actividad pesa `cantidad × duración planificada`, un proxy
 * de esfuerzo que sale solo del programa y no exige que nadie cargue pesos a
 * mano. Así "Excavación de 135 dados en 20 días" pesa mucho más que
 * "Instalación de faenas (3 un en 5 días)", que es el comportamiento correcto.
 */

import type {
  ObraCurvePoint,
  ObraDashboard,
  ObraLine,
  ObraMilestone,
  ObraPhase,
} from '@gmt-platform/contracts';

export type { ObraDashboard };

const MS_DAY = 86_400_000;

/** Reporte de avance de un día. */
export interface ProgressEntry {
  date: Date;
  quantity: number;
}

/**
 * Una actividad de obra como la necesita el cálculo. Es la ENTRADA del util,
 * no parte del contrato de la API: por eso vive acá y no en `contracts`.
 */
export interface ObraActivity {
  id: string;
  name: string;
  phaseId: string;
  phaseName: string;
  unit: string | null;
  /** Cantidad contractual. `null` en hitos. */
  quantityTotal: number | null;
  isMilestone: boolean;
  /** Programa vigente. */
  start: Date | null;
  end: Date | null;
  /** CPM: ventana temprana y tardía. Sin ellas no hay banda en la curva S. */
  earlyStart: Date | null;
  earlyFinish: Date | null;
  lateStart: Date | null;
  lateFinish: Date | null;
  progress: ProgressEntry[];
}

function dayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Suma de lo reportado para una actividad. */
export function doneOf(a: ObraActivity): number {
  return a.progress.reduce((s, p) => s + p.quantity, 0);
}

/**
 * Peso de la actividad: cantidad × días de duración. Los hitos pesan 0 (no
 * aportan avance físico, solo marcan fechas). Si una actividad no tiene fechas
 * se le asigna 1 día para que no desaparezca de la ponderación.
 */
export function weightOf(a: ObraActivity): number {
  if (a.isMilestone || !a.quantityTotal || a.quantityTotal <= 0) return 0;
  const days =
    a.start && a.end ? Math.max(1, (a.end.getTime() - a.start.getTime()) / MS_DAY) : 1;
  return a.quantityTotal * days;
}

/**
 * Fracción planificada de una actividad a una fecha, repartiendo su cantidad
 * LINEALMENTE entre `desde` y `hasta`. Es la convención estándar de curva S
 * cuando no hay perfil de producción por actividad.
 */
function plannedFractionAt(
  at: Date,
  desde: Date | null,
  hasta: Date | null,
): number {
  if (!desde || !hasta) return 0;
  const t = at.getTime();
  const a = desde.getTime();
  const b = hasta.getTime();
  if (t <= a) return 0;
  if (t >= b) return 1;
  if (b === a) return 1;
  return (t - a) / (b - a);
}

/** Días (a medianoche) que cubren el programa, para muestrear las curvas. */
function timeline(acts: ObraActivity[]): Date[] {
  const ts: number[] = [];
  for (const a of acts) {
    for (const d of [a.start, a.end, a.earlyStart, a.lateFinish]) if (d) ts.push(d.getTime());
    for (const p of a.progress) ts.push(p.date.getTime());
  }
  if (ts.length === 0) return [];
  const ini = new Date(Math.min(...ts));
  const fin = new Date(Math.max(...ts));
  ini.setUTCHours(0, 0, 0, 0);
  fin.setUTCHours(0, 0, 0, 0);
  // Una muestra por semana mantiene la curva liviana sin perder forma; se
  // agrega siempre el último día para que la curva cierre en el 100%.
  const out: Date[] = [];
  for (let t = ini.getTime(); t <= fin.getTime(); t += 7 * MS_DAY) out.push(new Date(t));
  const ultimoDia = out[out.length - 1];
  if (!ultimoDia || ultimoDia.getTime() !== fin.getTime()) out.push(fin);
  return out;
}

/** Curva planificada acumulada usando el par de fechas que se indique. */
function plannedCurve(
  acts: ObraActivity[],
  dias: Date[],
  totalWeight: number,
  desde: (a: ObraActivity) => Date | null,
  hasta: (a: ObraActivity) => Date | null,
): ObraCurvePoint[] {
  if (totalWeight <= 0) return [];
  return dias.map((d) => {
    let acc = 0;
    for (const a of acts) {
      const w = weightOf(a);
      if (w > 0) acc += w * plannedFractionAt(d, desde(a), hasta(a));
    }
    return { date: dayISO(d), value: Math.round((acc / totalWeight) * 1000) / 10 };
  });
}

/**
 * Curva REAL acumulada. Solo llega hasta el último día con reporte: dibujarla
 * hasta el fin del programa la haría parecer estancada en el futuro.
 */
function realCurve(acts: ObraActivity[], dias: Date[], totalWeight: number): ObraCurvePoint[] {
  if (totalWeight <= 0) return [];
  const reportes: Array<{ t: number; w: number }> = [];
  for (const a of acts) {
    const total = a.quantityTotal ?? 0;
    const w = weightOf(a);
    if (w <= 0 || total <= 0) continue;
    for (const p of a.progress) {
      reportes.push({ t: p.date.getTime(), w: (p.quantity / total) * w });
    }
  }
  if (reportes.length === 0) return [];
  const ultimo = Math.max(...reportes.map((r) => r.t));
  const out: ObraCurvePoint[] = [];
  for (const d of dias) {
    if (d.getTime() > ultimo) break;
    const acc = reportes.filter((r) => r.t <= d.getTime()).reduce((s, r) => s + r.w, 0);
    out.push({ date: dayISO(d), value: Math.round((acc / totalWeight) * 1000) / 10 });
  }
  // El punto del último reporte, para que la curva termine donde está la obra.
  const accFinal = reportes.reduce((s, r) => s + r.w, 0);
  const fin = dayISO(new Date(ultimo));
  const ultimoPunto = out[out.length - 1];
  if (!ultimoPunto || ultimoPunto.date !== fin) {
    out.push({ date: fin, value: Math.round((accFinal / totalWeight) * 1000) / 10 });
  }
  return out;
}

function semaforo(dev: number): ObraDashboard['status'] {
  if (dev >= 1) return 'ADELANTADO';
  if (dev >= -1) return 'EN_LINEA';
  if (dev >= -5) return 'LEVE_ATRASO';
  return 'ATRASADO';
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
}

/** Arma el dashboard completo de una obra. */
export function computeObraDashboard(
  projectId: string,
  projectName: string,
  activities: ObraActivity[],
  now: Date,
): ObraDashboard {
  const reales = activities.filter((a) => !a.isMilestone);
  const totalWeight = reales.reduce((s, a) => s + weightOf(a), 0);

  // ── Avance real ponderado ──
  let acc = 0;
  for (const a of reales) {
    const w = weightOf(a);
    const total = a.quantityTotal ?? 0;
    if (w > 0 && total > 0) acc += w * Math.min(1, doneOf(a) / total);
  }
  const realProgress = totalWeight > 0 ? Math.round((acc / totalWeight) * 1000) / 10 : 0;

  // ── Avance planificado a la fecha, con el programa vigente ──
  let accPlan = 0;
  for (const a of reales) {
    const w = weightOf(a);
    if (w > 0) accPlan += w * plannedFractionAt(now, a.start, a.end);
  }
  const plannedProgress = totalWeight > 0 ? Math.round((accPlan / totalWeight) * 1000) / 10 : 0;
  const deviation = Math.round((realProgress - plannedProgress) * 10) / 10;

  // ── Fases con sus actividades ──
  const porFase = new Map<string, ObraActivity[]>();
  for (const a of reales) {
    const arr = porFase.get(a.phaseId);
    if (arr) arr.push(a);
    else porFase.set(a.phaseId, [a]);
  }
  const phases: ObraPhase[] = [...porFase.entries()].map(([phaseId, acts]) => {
    const activities2: ObraLine[] = acts.map((a) => {
      const total = a.quantityTotal ?? 0;
      const done = Math.min(doneOf(a), total);
      return {
        id: a.id,
        name: a.name,
        unit: a.unit,
        quantityTotal: total,
        quantityDone: done,
        percent: pct(done, total),
      };
    });
    // El % de la fase se pondera igual que el global, no es el promedio simple
    // de sus actividades: si no, una partida chica pesaría lo mismo que una grande.
    const wFase = acts.reduce((s, a) => s + weightOf(a), 0);
    let accFase = 0;
    for (const a of acts) {
      const w = weightOf(a);
      const total = a.quantityTotal ?? 0;
      if (w > 0 && total > 0) accFase += w * Math.min(1, doneOf(a) / total);
    }
    return {
      id: phaseId,
      name: acts[0]?.phaseName ?? 'Sin fase',
      unit: null,
      quantityTotal: activities2.reduce((s, x) => s + x.quantityTotal, 0),
      quantityDone: activities2.reduce((s, x) => s + x.quantityDone, 0),
      percent: wFase > 0 ? Math.round((accFase / wFase) * 1000) / 10 : 0,
      activities: activities2,
    };
  });

  // ── Hitos ──
  const milestones: ObraMilestone[] = activities
    .filter((a) => a.isMilestone)
    .map((a) => ({
      id: a.id,
      name: a.name,
      date: a.end ? dayISO(a.end) : null,
      done: a.end ? a.end.getTime() <= now.getTime() : false,
    }))
    .sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));

  // ── Curvas ──
  const dias = timeline(activities);
  const curves = {
    early: plannedCurve(reales, dias, totalWeight, (a) => a.earlyStart, (a) => a.earlyFinish),
    scheduled: plannedCurve(reales, dias, totalWeight, (a) => a.start, (a) => a.end),
    late: plannedCurve(reales, dias, totalWeight, (a) => a.lateStart, (a) => a.lateFinish),
    real: realCurve(reales, dias, totalWeight),
  };

  const inicios = reales.map((a) => a.start).filter((d): d is Date => d !== null);
  const fines = reales.map((a) => a.end).filter((d): d is Date => d !== null);

  return {
    projectId,
    projectName,
    realProgress,
    plannedProgress,
    deviation,
    status: semaforo(deviation),
    phases,
    milestones,
    curves,
    programStart: inicios.length ? dayISO(new Date(Math.min(...inicios.map((d) => d.getTime())))) : null,
    programEnd: fines.length ? dayISO(new Date(Math.max(...fines.map((d) => d.getTime())))) : null,
    asOf: dayISO(now),
  };
}
