/**
 * Horas extra: cómputo de horas trabajadas a partir de "HH:mm" de inicio y término
 * (spec §5.6). Término < inicio → cruce de medianoche (+24h); término == inicio → 0
 * (jornada de duración nula, lo que da el módulo `(end - start + 1440) % 1440`).
 * Resultado en horas decimales, redondeado a 2 decimales.
 */
export function computeHours(startTime: string, endTime: string): number {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const diff = (end - start + 1440) % 1440; // 0..1439 (0 cuando end == start)
  return Math.round((diff / 60) * 100) / 100;
}

/** Convierte "HH:mm" a minutos desde medianoche. Asume formato ya validado. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}
