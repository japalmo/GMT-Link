/**
 * "Hoy" y "mes contable en curso" anclados a la hora de pared de Chile
 * (America/Santiago), espejo de finance-time.util.ts del backend.
 *
 * Los valores de fila (fechas date-only) se siguen leyendo en UTC vía
 * `overtimeMonth` en finance-overview.ts; acá solo se resuelve el instante
 * ACTUAL al día calendario chileno para el prefill de formularios y el filtro
 * por defecto. Se usa Intl con timeZone (no un offset fijo) => DST-safe.
 */

const SANTIAGO_TZ = 'America/Santiago';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SANTIAGO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function santiagoParts(now: Date): { year: number; month: number; day: number } {
  const parts = partsFmt.formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Día calendario de Chile en formato YYYY-MM-DD (para el prefill de fecha). */
export function todaySantiagoString(now: Date = new Date()): string {
  const { year, month, day } = santiagoParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Primer día del mes en curso (día de Chile), en formato YYYY-MM-DD. Espejo de
 * `startOfMonthSantiago` del backend: límite inferior (inclusive) de la ventana
 * "todo el mes en curso" para reportar gastos y horas extra.
 */
export function startOfMonthSantiagoString(now: Date = new Date()): string {
  const { year, month } = santiagoParts(now);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Mes contable en curso "YYYY-MM" (cierre día 20) según el día de Chile.
 * Mismo criterio que `accountingMonth` del backend: día > 20 empuja al mes
 * siguiente.
 */
export function currentAccountingMonth(now: Date = new Date()): string {
  const { year, month, day } = santiagoParts(now);
  let y = year;
  let m = month;
  if (day > 20) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}
