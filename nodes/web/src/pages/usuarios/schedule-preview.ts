import type { ShiftPattern, WorkScheduleView } from '@gmt-platform/contracts';

/** Un día del preview de jornada: la fecha y si es día en faena o de descanso. */
export interface SchedulePreviewDay {
  date: Date;
  /** `true` = día en faena (trabajo); `false` = descanso. */
  working: boolean;
}

/** Etiqueta legible (es-CL) de cada patrón de turno. */
export const SHIFT_PATTERN_LABEL: Record<ShiftPattern, string> = {
  ADMINISTRATIVO: 'Administrativo (lunes a viernes)',
  SIETE_POR_SIETE: '7x7 (7 en faena, 7 de descanso)',
  CUATRO_POR_TRES: '4x3 (4 en faena, 3 de descanso)',
  CATORCE_POR_CATORCE: '14x14 (14 en faena, 14 de descanso)',
  PERSONALIZADO: 'Personalizado',
};

/** Medianoche local de una fecha (ignora la hora) — para contar días sin drift de TZ. */
function atLocalMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Días completos entre dos fechas (a menos b), a medianoche local. */
function daysBetween(a: Date, b: Date): number {
  const ms = atLocalMidnight(a).getTime() - atLocalMidnight(b).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Interpreta la parte de fecha de un ISO como fecha LOCAL (medianoche local), no
 * UTC. `cycleStart` es una fecha-sin-hora; parsear el ISO directo la correría por
 * la zona horaria de Chile. Extraemos "YYYY-MM-DD" y construimos la fecha local.
 */
function parseDateOnlyLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : atLocalMidnight(d);
}

/**
 * ¿Es día de faena para esta jornada en la fecha dada? ADMINISTRATIVO = lunes a
 * viernes. Cíclico = `(díasDesdeCycleStart mod ciclo) < workDays`. Devuelve `null`
 * si no se puede determinar (patrón cíclico sin días de ciclo o sin fecha de inicio).
 */
export function isWorkingDay(schedule: WorkScheduleView, date: Date): boolean | null {
  if (schedule.shiftPattern === 'ADMINISTRATIVO') {
    const dow = date.getDay(); // 0 dom … 6 sáb
    return dow >= 1 && dow <= 5;
  }
  const { workDays, restDays, cycleStart } = schedule;
  if (!workDays || !restDays || !cycleStart) return null;
  const start = parseDateOnlyLocal(cycleStart);
  if (!start) return null;
  const cycle = workDays + restDays;
  const diff = daysBetween(date, start);
  const pos = ((diff % cycle) + cycle) % cycle; // módulo siempre positivo
  return pos < workDays;
}

/**
 * Próximos `days` días desde `from`, marcados faena/descanso. Devuelve `[]` si la
 * jornada no permite determinar el ciclo (p. ej. cíclica sin fecha de inicio).
 */
export function buildSchedulePreview(
  schedule: WorkScheduleView,
  from: Date,
  days = 14,
): SchedulePreviewDay[] {
  const out: SchedulePreviewDay[] = [];
  const base = atLocalMidnight(from);
  for (let i = 0; i < days; i += 1) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const working = isWorkingDay(schedule, date);
    if (working === null) return [];
    out.push({ date, working });
  }
  return out;
}
