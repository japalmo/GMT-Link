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

/** Un turno colocado con un desfase de días (en minutos), o `null` si ese día no tiene turno. */
interface PlacedShift {
  shift: DayShift | null;
  /** Desfase en minutos: -1440 (día anterior), 0 (día de la fecha), +1440 (día siguiente). */
  offset: number;
}

/**
 * Minutos del periodo [otStart, otEnd] cubiertos por AL MENOS UNO de los turnos
 * colocados (unión de intervalos, sin doble conteo). Cada turno se coloca en el eje
 * de minutos del día de la fecha según su desfase; el turno del día siguiente en
 * +1440 y la cola de un turno nocturno del día anterior en -1440. A diferencia de
 * replicar UN turno cada día, aquí un día de DESCANSO (turno `null`) no aporta nada.
 */
function coveredMinutes(otStartMin: number, otEndMin: number, placed: PlacedShift[]): number {
  const intervals: Array<[number, number]> = [];
  for (const { shift, offset } of placed) {
    if (!shift) continue;
    const s = Math.max(otStartMin, shift.startMin + offset);
    const e = Math.min(otEndMin, shift.endMin + offset);
    if (e > s) intervals.push([s, e]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of intervals) {
    if (cur === null) {
      cur = [s, e];
    } else if (s <= cur[1]) {
      cur[1] = Math.max(cur[1], e); // se solapan/tocan: fusiona
    } else {
      total += cur[1] - cur[0];
      cur = [s, e];
    }
  }
  if (cur !== null) total += cur[1] - cur[0];
  return total;
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
 * Desglosa el periodo [startTime, endTime] contra el turno del día: total, tramo de
 * turno normal y hora extra real (total menos el solape con el turno). Sin turno
 * (`shift === null`) => todo el periodo es hora extra.
 *
 * Cuando el periodo cruza la medianoche, el tramo del día siguiente se descuenta
 * contra el turno REAL de ESE día (`shiftNext`), no una copia del turno del día de la
 * fecha: así un día de descanso no acredita "turno normal" fantasma (subvaluando la
 * HE). `shiftPrev` cubre la cola de un turno nocturno del día anterior que aún corre
 * al inicio del periodo. Ambos son opcionales (default `null`): un llamador que no los
 * pasa solo descuenta el turno del día de la fecha.
 */
export function computeOvertimeBreakdown(
  startTime: string,
  endTime: string,
  shift: DayShift | null,
  shiftPrev: DayShift | null = null,
  shiftNext: DayShift | null = null,
): OvertimeBreakdown {
  const startMin = toMinutes(startTime);
  const totalMin = (toMinutes(endTime) - startMin + 1440) % 1440; // 0..1439 (== computeHours)
  const otStart = startMin;
  const otEnd = startMin + totalMin;

  const regularMin = coveredMinutes(otStart, otEnd, [
    { shift: shiftPrev, offset: -1440 },
    { shift, offset: 0 },
    { shift: shiftNext, offset: 1440 },
  ]);
  const overtimeMin = totalMin - regularMin;

  return {
    totalHours: minutesToHours(totalMin),
    regularHours: minutesToHours(regularMin),
    overtimeHours: minutesToHours(overtimeMin),
    shiftLabel: shift ? shift.label : null,
  };
}
