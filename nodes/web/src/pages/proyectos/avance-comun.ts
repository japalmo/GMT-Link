import type { AvanceActividadEditable } from '@gmt-platform/contracts';

/**
 * Piezas compartidas por las tablas de la pestaña "Avance".
 *
 * La API y la base guardan fracciones 0-1; la pantalla muestra 0-100. La
 * conversión vive SOLO acá: repartida por los componentes, tarde o temprano
 * alguno manda un 23,7 donde se esperaba 0,237.
 */

/** Fracción 0-1 → porcentaje 0-100, o `null`. */
export function aPorcentaje(fraccion: number | null | undefined): number | null {
  return fraccion === null || fraccion === undefined ? null : fraccion * 100;
}

/**
 * Porcentaje 0-100 → fracción 0-1. Redondeada a 6 decimales: 27,4 / 100 da
 * 0,27399999999999997 en coma flotante, y ese ruido no tiene por qué quedar
 * guardado en un informe.
 */
export function aFraccion(porcentaje: number): number {
  return Math.round(porcentaje * 10_000) / 1_000_000;
}

/** Porcentaje con un decimal y coma, como se informa. */
export function formatoPct(porcentaje: number | null): string {
  if (porcentaje === null) return '—';
  return `${(Math.round(porcentaje * 10) / 10).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

/** Diferencia en puntos, con signo. */
export function formatoDelta(puntos: number): string {
  const r = Math.round(puntos * 10) / 10;
  // Siempre con un decimal, como el informe: "+3,0", no "+3".
  const texto = Math.abs(r).toLocaleString('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return r > 0 ? `+${texto}` : r < 0 ? `−${texto}` : '0,0';
}

/**
 * Acumulado de una actividad en una semana: si no la informó, lo último que
 * informó. Es la misma regla que aplica el servidor (`acumuladoAl`); acá solo
 * se usa para MOSTRAR el valor arrastrado y los subtotales por fase.
 */
export function acumuladoAl(realByWeek: readonly number[], semana: number): number {
  if (realByWeek.length === 0) return 0;
  return realByWeek[Math.min(semana, realByWeek.length - 1)] ?? 0;
}

/** Avance ponderado por HH de un grupo de actividades en una semana, 0-1. */
export function ponderado(grupo: readonly AvanceActividadEditable[], semana: number): number | null {
  const hh = grupo.reduce((s, a) => s + Math.max(0, a.hh), 0);
  if (hh <= 0) return null;
  return grupo.reduce((s, a) => s + Math.max(0, a.hh) * acumuladoAl(a.realByWeek, semana), 0) / hh;
}

/** Orden del programa: primero lo que ocurre antes. Igual que el informe. */
const ORDEN_FASES = ['Hitos', 'Gestión', 'Suministros', 'Construcción', 'Cierre'];

export function porFase(
  actividades: readonly AvanceActividadEditable[],
): Array<{ fase: string; actividades: AvanceActividadEditable[] }> {
  const grupos = new Map<string, AvanceActividadEditable[]>();
  for (const a of actividades) {
    const lista = grupos.get(a.phase) ?? [];
    lista.push(a);
    grupos.set(a.phase, lista);
  }
  const posicion = (f: string): number => {
    const i = ORDEN_FASES.indexOf(f);
    return i === -1 ? ORDEN_FASES.length : i;
  };
  return [...grupos.entries()]
    .sort(([x], [y]) => posicion(x) - posicion(y) || x.localeCompare(y, 'es'))
    .map(([fase, lista]) => ({ fase, actividades: lista }));
}

/** Fecha aaaa-mm-dd a "27 sep". */
export function fechaCorta(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '');
}
