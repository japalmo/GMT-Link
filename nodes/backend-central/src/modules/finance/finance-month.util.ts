/**
 * Cierre mensual de finanzas = día 20 (spec §2.4). Para agrupar por "mes", una
 * fecha con día <= 20 pertenece a su mes calendario; con día > 20 cuenta como el
 * mes siguiente. El mes contable se expresa "YYYY-MM".
 */

/** Mes contable "YYYY-MM" de una fecha, aplicando el cierre del día 20 (UTC). */
export function accountingMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based
  const day = date.getUTCDate();
  // día > 20 empuja al mes siguiente
  const shifted = new Date(Date.UTC(year, month + (day > 20 ? 1 : 0), 1));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Rango de fechas [gte, lt) que abarca el mes contable "YYYY-MM" (cierre día 20). */
export function monthRange(month: string): { gte: Date; lt: Date } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // 0-based
  // El mes contable M abarca desde el 21 del mes anterior (00:00) hasta el 21 de M (00:00).
  const gte = new Date(Date.UTC(year, monthIndex - 1, 21, 0, 0, 0, 0));
  const lt = new Date(Date.UTC(year, monthIndex, 21, 0, 0, 0, 0));
  return { gte, lt };
}
