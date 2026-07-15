/**
 * Horas extra: cómputo de horas a partir de "HH:mm" de inicio y término (spec §5.6),
 * y DESGLOSE contra el turno del trabajador (turno normal vs. hora extra real).
 *
 * La "hora extra" real es el tramo del periodo trabajado que NO se solapa con el
 * turno de ese día. Ej: turno 08:00-18:00, registra 06:00-18:00 (12 h) => 2 h extra
 * (06:00-08:00) y 10 h de turno normal. Si el día es de descanso (o no hay turno
 * determinable), todo el periodo es hora extra.
 */

/** Convierte "HH:mm" a minutos desde medianoche. Asume formato ya validado. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Horas decimales (2 decimales) desde minutos. */
function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Horas TOTALES trabajadas entre inicio y término. Término < inicio => cruce de
 * medianoche (+24h); término == inicio => 0 (jornada de duración nula), vía
 * `(end - start + 1440) % 1440`. Resultado en horas decimales.
 */
export function computeHours(startTime: string, endTime: string): number {
  const total = (toMinutes(endTime) - toMinutes(startTime) + 1440) % 1440;
  return minutesToHours(total);
}

/** Campos de la jornada que necesita el resolvedor de turno (subconjunto de WorkSchedule). */
export interface ShiftScheduleInput {
  shiftPattern: string; // 'ADMINISTRATIVO' | 'SIETE_POR_SIETE' | ... | 'PERSONALIZADO'
  workDays: number | null;
  restDays: number | null;
  cycleStart: Date | null;
  startTime: string | null;
  endTime: string | null;
  weeklyHours: unknown; // Json: [{ weekday, start, end }]
}

/** Turno de un día: minutos de inicio/fin (fin "desenrollado" si cruza medianoche) + etiqueta. */
export interface DayShift {
  startMin: number;
  /** Puede superar 1440 cuando el turno nocturno cruza la medianoche. */
  endMin: number;
  /** "HH:mm-HH:mm" para mostrar en el detalle. */
  label: string;
}

/** Una entrada validada del horario semanal. */
interface WeeklyEntry {
  weekday: number;
  start: string;
  end: string;
}

/**
 * Parsea `weeklyHours` (Json) a entradas válidas. Devuelve `null` si el valor no es
 * un arreglo (fila legacy / cíclica); un arreglo vacío es válido (sin días).
 */
function parseWeeklyHours(raw: unknown): WeeklyEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WeeklyEntry[] = [];
  for (const e of raw) {
    if (
      e &&
      typeof e === 'object' &&
      typeof (e as { weekday?: unknown }).weekday === 'number' &&
      typeof (e as { start?: unknown }).start === 'string' &&
      typeof (e as { end?: unknown }).end === 'string'
    ) {
      const entry = e as WeeklyEntry;
      out.push({ weekday: entry.weekday, start: entry.start, end: entry.end });
    }
  }
  return out;
}

/**
 * Día de la semana ISO (1=lunes .. 7=domingo) a partir de las partes UTC de la
 * fecha. Las fechas de finanzas se guardan como medianoche UTC ancladas al día
 * CALENDARIO de Chile (ver finance-time.util), así que sus partes UTC SON ese día.
 */
function isoWeekdayUtc(date: Date): number {
  const dow = date.getUTCDay(); // 0 dom .. 6 sáb
  return dow === 0 ? 7 : dow;
}

/** Días completos entre dos fechas a medianoche UTC (a menos b). */
function utcMidnightDays(a: Date, b: Date): number {
  const am = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bm = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((am - bm) / 86_400_000);
}

/**
 * Turno del trabajador para la fecha dada, o `null` si ese día es de descanso, no
 * hay jornada determinable, o no tiene horas definidas. Réplica en backend de la
 * lógica de `schedule-preview.ts` (isWorkingDay/workingHours), operando sobre la
 * fila `WorkSchedule` y la convención date-only UTC del almacenamiento.
 */
export function resolveShiftForDate(
  schedule: ShiftScheduleInput | null,
  date: Date,
): DayShift | null {
  if (!schedule) return null;

  let start: string | null;
  let end: string | null;

  if (schedule.shiftPattern === 'ADMINISTRATIVO') {
    const weekly = parseWeeklyHours(schedule.weeklyHours);
    if (weekly !== null) {
      // Horario semanal: solo los días listados son de trabajo.
      const entry = weekly.find((e) => e.weekday === isoWeekdayUtc(date));
      if (!entry) return null;
      start = entry.start;
      end = entry.end;
    } else {
      // Legacy (sin weeklyHours): lunes a viernes con la jornada única.
      const weekday = isoWeekdayUtc(date);
      if (weekday < 1 || weekday > 5) return null;
      start = schedule.startTime;
      end = schedule.endTime;
    }
  } else {
    // Cíclico (7x7, 4x3, 14x14, personalizado): faena si (días desde cycleStart mod ciclo) < workDays.
    const { workDays, restDays, cycleStart } = schedule;
    if (!workDays || !restDays || !cycleStart) return null;
    const cycle = workDays + restDays;
    const pos = ((utcMidnightDays(date, cycleStart) % cycle) + cycle) % cycle;
    if (pos >= workDays) return null; // día de descanso
    start = schedule.startTime;
    end = schedule.endTime;
  }

  if (!start || !end) return null; // día de trabajo pero sin horas definidas

  const startMin = toMinutes(start);
  let endMin = toMinutes(end);
  if (endMin <= startMin) endMin += 1440; // turno nocturno cruza la medianoche
  return { startMin, endMin, label: `${start}-${end}` };
}

/** Minutos de solapamiento del periodo [otStart, otEnd] con el turno diario (recurrente). */
function shiftOverlapMinutes(otStartMin: number, otEndMin: number, shift: DayShift): number {
  // El turno se repite cada día: un minuto del periodo cuenta como turno si su hora
  // de reloj cae dentro de [start, end]. Se evalúan las copias k=-1/0/+1 para cubrir
  // periodos que cruzan la medianoche y turnos nocturnos del día anterior/siguiente.
  let overlap = 0;
  for (const k of [-1, 0, 1]) {
    const s = shift.startMin + k * 1440;
    const e = shift.endMin + k * 1440;
    overlap += Math.max(0, Math.min(otEndMin, e) - Math.max(otStartMin, s));
  }
  return Math.min(overlap, otEndMin - otStartMin);
}

/** Desglose de un periodo de horas extra contra el turno del día. */
export interface OvertimeBreakdown {
  /** Horas totales del periodo trabajado. */
  totalHours: number;
  /** Horas que caen dentro del turno normal. */
  regularHours: number;
  /** Horas extra reales (fuera del turno). Es el valor "pagable". */
  overtimeHours: number;
  /** Turno usado "HH:mm-HH:mm", o `null` si el día es de descanso / sin turno. */
  shiftLabel: string | null;
}

/**
 * Desglosa el periodo [startTime, endTime] contra el `shift` del día: total, tramo
 * de turno normal y hora extra real (total menos el solape con el turno). Sin turno
 * (`shift === null`) => todo el periodo es hora extra.
 */
export function computeOvertimeBreakdown(
  startTime: string,
  endTime: string,
  shift: DayShift | null,
): OvertimeBreakdown {
  const startMin = toMinutes(startTime);
  const totalMin = (toMinutes(endTime) - startMin + 1440) % 1440; // 0..1439 (== computeHours)
  const otStart = startMin;
  const otEnd = startMin + totalMin;

  const regularMin = shift ? shiftOverlapMinutes(otStart, otEnd, shift) : 0;
  const overtimeMin = totalMin - regularMin;

  return {
    totalHours: minutesToHours(totalMin),
    regularHours: minutesToHours(regularMin),
    overtimeHours: minutesToHours(overtimeMin),
    shiftLabel: shift ? shift.label : null,
  };
}
