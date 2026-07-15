/**
 * Fuentes de "hoy/ahora" ancladas a la hora de pared de Chile (America/Santiago).
 *
 * El almacenamiento de finanzas usa fechas date-only ancladas a medianoche UTC
 * (ver finance-month.util.ts): `accountingMonth`/`monthRange` operan sobre esos
 * valores como aritmética de calendario y son correctas sin importar la zona.
 * El problema es distinto: cuando el servidor decide "el día de HOY" para fijar
 * la fecha de una HE sin permiso onBehalf, debe usar el día CALENDARIO de Chile,
 * no el de UTC. De noche en Chile ya es el día siguiente en UTC, así una HE
 * cargada a las 23:00 del 20 caía en el mes contable siguiente.
 *
 * Se usa Intl.DateTimeFormat con timeZone (NO un offset fijo) para que el
 * horario de verano de Chile (UTC-4 invierno / UTC-3 verano) se resuelva solo.
 */

export const SANTIAGO_TZ = 'America/Santiago';

const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: SANTIAGO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Partes año/mes/día del día calendario de Chile para un instante dado. */
export function santiagoDateParts(instant: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = dtf.formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Medianoche UTC ancla del DÍA CALENDARIO de Chile del instante dado. Conserva la
 * convención date-only del almacenamiento (misma forma que `parseDate` sobre un
 * 'YYYY-MM-DD'), de modo que `accountingMonth` lo clasifica correctamente.
 */
export function startOfTodaySantiago(instant: Date = new Date()): Date {
  const { year, month, day } = santiagoDateParts(instant);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/**
 * Medianoche UTC ancla del día que queda EXACTAMENTE 1 mes CALENDARIO antes del
 * día chileno del instante dado (límite inferior de la ventana de fecha de los
 * reembolsos en versión beta). Mismo día del mes anterior, inclusive: hoy 15-jul
 * permite desde el 15-jun. Si el mes anterior no tiene ese día (p. ej. 31-mar),
 * se ajusta al último día de ese mes (28/29-feb). Conserva la convención
 * date-only de `startOfTodaySantiago` (comparable con `parseDate('YYYY-MM-DD')`).
 */
export function oneMonthAgoSantiago(instant: Date = new Date()): Date {
  const { year, month, day } = santiagoDateParts(instant);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1; // 1-based
  // Día 0 del mes SIGUIENTE al anterior (índice 0-based = prevMonth) = último día
  // del mes anterior; con eso se clampa un 31 a 28/29/30 según corresponda.
  const lastDayOfPrev = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  return new Date(Date.UTC(prevYear, prevMonth - 1, Math.min(day, lastDayOfPrev), 0, 0, 0, 0));
}
