/**
 * Helpers de formato compartidos por el frontend (fechas, tamaños). Sin estado
 * y sin dependencias de UI para poder reutilizarse en cualquier página.
 */

/**
 * Formateador de fecha en formato corto: "14 jun 2026". Ancla en UTC porque las
 * fechas date-only del sistema se guardan a medianoche UTC (representan el día de
 * calendario que eligió el usuario); sin `timeZone`, un dispositivo al oeste de
 * UTC (Chile) mostraría el día anterior.
 */
const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Formatea una fecha ISO a texto legible en español. Devuelve `fallback` si la
 * entrada es `null`/vacía o no es una fecha válida.
 */
export function formatDate(iso: string | null | undefined, fallback = '—'): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return dateFormatter.format(date);
}

/**
 * Formatea un rango de fechas ("ene 2020 – actual"). Si no hay `end`, usa
 * `present` (por defecto "Actual"). Si no hay `start`, devuelve solo el `end`.
 */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  present = 'Actual',
): string {
  const startText = start ? formatDate(start) : '';
  const endText = end ? formatDate(end) : present;
  if (!startText && !end) return present === 'Actual' ? '' : endText;
  if (!startText) return endText;
  return `${startText} - ${endText}`;
}

/**
 * Convierte un valor ISO (con hora) a `yyyy-MM-dd` para `<input type="date">`.
 * Devuelve '' si la entrada no es válida.
 */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/**
 * Formateador de fecha + hora corta es-CL ("15-07-2026, 09:30") para timestamps
 * con hora local (entregas y solicitudes de insumos). A diferencia de
 * `formatDate`, NO ancla en UTC: estos valores son instantes reales, no fechas
 * de calendario.
 */
const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Formatea un timestamp ISO a fecha + hora corta es-CL. Devuelve '' si es inválido. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return dateTimeFormatter.format(date);
}

/** Formateador de tiempo relativo en español de Chile ("hace 5 min"). */
const relativeFormatter = new Intl.RelativeTimeFormat('es-CL', {
  numeric: 'auto',
});

/** Umbrales de tiempo relativo (segundos por unidad), de mayor a menor. */
const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

/**
 * Formatea una fecha ISO como tiempo relativo en es-CL ("hace 5 minutos",
 * "ayer"). Para diferencias menores a un minuto devuelve "hace un momento".
 * Devuelve `fallback` si la entrada es inválida.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  fallback = '—',
): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;

  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 60) return 'hace un momento';

  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (absSeconds >= seconds) {
      const value = Math.round(diffSeconds / seconds);
      return relativeFormatter.format(value, unit);
    }
  }
  return 'hace un momento';
}

/** Formateador de moneda chilena (CLP, sin decimales): "$ 25.000". */
const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

/**
 * Formatea un monto entero en pesos chilenos ("$25.000"). CLP no usa decimales.
 */
export function formatCLP(amount: number): string {
  return clpFormatter.format(amount);
}

/**
 * Formatea horas decimales en español chileno con la unidad ("8,33 hrs"): coma
 * decimal y máximo 2 decimales. Redondea al mostrar, así que absorbe las colas de
 * coma flotante de las sumas acumuladas (p. ej. 1,1 + 2,2 = "3,3 hrs", no "3.3000…").
 */
export function formatHours(hours: number): string {
  return `${hours.toLocaleString('es-CL', { maximumFractionDigits: 2 })} hrs`;
}

/** Formatea un tamaño en bytes a texto legible ("2,4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`;
}
