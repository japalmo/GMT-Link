import type {
  UsageCyclePerson,
  UsageCycleStatus,
  UsageEndKind,
} from '@/types/assets';

/** Etiquetas es-CL de los estados de un ciclo de uso. */
export const USAGE_STATUS_LABELS: Record<UsageCycleStatus, string> = {
  EN_PREPARACION: 'En preparación',
  EN_CURSO: 'En uso',
  CERRADO: 'Cerrado',
  CANCELADO: 'Cancelado',
};

/** Etiquetas es-CL de la forma de cierre de un ciclo. */
export const USAGE_END_KIND_LABELS: Record<UsageEndKind, string> = {
  GPS: 'Ubicación GPS',
  ESTACIONAMIENTO: 'Estacionamiento',
  TRASPASO: 'Traspaso',
};

/** Nombre legible de una persona del ciclo (o un fallback). */
export function personName(
  person: UsageCyclePerson | null | undefined,
  fallback = 'Desconocido',
): string {
  if (!person) return fallback;
  return `${person.firstName} ${person.lastName}`.trim() || fallback;
}

/**
 * Formatea una duración en segundos a "1h 05m 09s" (omite las horas si son 0).
 * Nunca devuelve negativo: aterriza en "0s".
 */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

/**
 * Duración entre dos instantes ISO en texto ("2h 15m 03s"). Si falta el término,
 * devuelve `fallback`. Redondea a segundos.
 */
export function formatCycleDuration(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  fallback = '—',
): string {
  if (!startIso || !endIso) return fallback;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return fallback;
  return formatDuration((end - start) / 1000);
}
