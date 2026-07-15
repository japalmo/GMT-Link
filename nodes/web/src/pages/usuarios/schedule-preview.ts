import type { ShiftPattern, WorkScheduleView } from '@gmt-platform/contracts';

/** Un día del preview de jornada: la fecha, si se trabaja y con qué horario. */
export interface SchedulePreviewDay {
  date: Date;
  /** `true` = día en faena (trabajo); `false` = descanso. */
  working: boolean;
  /** Horario del día "HH:mm-HH:mm"; null en descanso o si no hay horas definidas. */
  hours: string | null;
}

/** Etiqueta legible (es-CL) de cada patrón de turno. */
export const SHIFT_PATTERN_LABEL: Record<ShiftPattern, string> = {
  ADMINISTRATIVO: 'Administrativo (horario semanal)',
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

/** Día de la semana en convención ISO-8601: 1 = lunes .. 7 = domingo. */
function isoWeekday(date: Date): number {
  const dow = date.getDay(); // 0 dom … 6 sáb
  return dow === 0 ? 7 : dow;
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
 * ¿Es día de faena para esta jornada en la fecha dada? ADMINISTRATIVO con
 * `weeklyHours` = el día de la semana aparece en el horario semanal;
 * ADMINISTRATIVO legacy (`weeklyHours` null) = lunes a viernes. Cíclico =
 * `(díasDesdeCycleStart mod ciclo) < workDays`. Devuelve `null` si no se puede
 * determinar (patrón cíclico sin días de ciclo o sin fecha de inicio).
 */
export function isWorkingDay(schedule: WorkScheduleView, date: Date): boolean | null {
  if (schedule.shiftPattern === 'ADMINISTRATIVO') {
    if (schedule.weeklyHours !== null) {
      const weekday = isoWeekday(date);
      return schedule.weeklyHours.some((entry) => entry.weekday === weekday);
    }
    // Fila legacy sin horario semanal: lunes a viernes.
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
 * Horario "HH:mm-HH:mm" de un día trabajado. ADMINISTRATIVO con `weeklyHours`
 * usa las horas de ese día de la semana; en el resto (cíclicos y legacy) rige la
 * jornada única `startTime`/`endTime`. `null` si las horas no están definidas.
 */
export function workingHours(schedule: WorkScheduleView, date: Date): string | null {
  if (schedule.shiftPattern === 'ADMINISTRATIVO' && schedule.weeklyHours !== null) {
    const weekday = isoWeekday(date);
    const entry = schedule.weeklyHours.find((e) => e.weekday === weekday);
    return entry && entry.start && entry.end ? `${entry.start}-${entry.end}` : null;
  }
  return schedule.startTime && schedule.endTime
    ? `${schedule.startTime}-${schedule.endTime}`
    : null;
}

/**
 * Próximos `days` días desde `from`, marcados faena/descanso y con el horario
 * del día cuando corresponde. Devuelve `[]` si la jornada no permite determinar
 * el ciclo (p. ej. cíclica sin fecha de inicio).
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
    out.push({ date, working, hours: working ? workingHours(schedule, date) : null });
  }
  return out;
}
