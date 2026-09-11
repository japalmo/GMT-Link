import type { ReactNode } from 'react';
import type { HrVigencia } from '@gmt-platform/contracts';

/**
 * Piezas compartidas de RRHH. Viven aparte para que el listado, la ficha y el
 * tablero hablen el mismo idioma sobre la vigencia: si cada pantalla decidiera
 * por su cuenta qué es "por vencer", el mismo trabajador se vería distinto
 * según dónde se le mire.
 */

export type RrhhTab = 'dashboard' | 'directorio';

export type FichaTab = 'resumen' | 'datos' | 'documentos' | 'examenes' | 'inducciones';

/**
 * Cómo se nombra y se pinta cada vigencia.
 *
 * El color SIEMPRE va acompañado de texto: quien no distingue rojo de verde
 * tiene que poder leer si un examen está vencido, y en una impresión en blanco
 * y negro el color no existe.
 */
export const VIGENCIA: Record<
  HrVigencia,
  { label: string; clase: string; orden: number }
> = {
  VENCIDO: {
    label: 'Vencido',
    clase:
      'bg-red-100 text-red-900 ring-1 ring-red-300 dark:bg-red-950/60 dark:text-red-100 dark:ring-red-900',
    orden: 0,
  },
  POR_VENCER: {
    label: 'Por vencer',
    clase:
      'bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-900',
    orden: 1,
  },
  SIN_FECHA: {
    label: 'Sin fecha',
    clase:
      'bg-slate-100 text-slate-700 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
    orden: 2,
  },
  VIGENTE: {
    label: 'Vigente',
    clase:
      'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-900',
    orden: 3,
  },
  SIN_VENCIMIENTO: {
    label: 'No vence',
    clase:
      'bg-sky-100 text-sky-900 ring-1 ring-sky-300 dark:bg-sky-950/60 dark:text-sky-100 dark:ring-sky-900',
    orden: 4,
  },
};

/** Etiqueta de vigencia. Texto y color juntos, nunca color solo. */
export function EtiquetaVigencia({
  vigencia,
  diasRestantes,
}: {
  vigencia: HrVigencia;
  diasRestantes?: number | null;
}): ReactNode {
  const v = VIGENCIA[vigencia];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${v.clase}`}
      title={plazoLargo(vigencia, diasRestantes)}
    >
      {v.label}
      {diasRestantes !== null && diasRestantes !== undefined && vigencia !== 'VIGENTE' && (
        <span className="ml-1 font-normal tabular-nums opacity-80">{plazoCorto(diasRestantes)}</span>
      )}
    </span>
  );
}

/** "hace 3 d", "en 12 d". Corto, para caber en una celda. */
export function plazoCorto(dias: number): string {
  if (dias < 0) return `hace ${-dias} d`;
  if (dias === 0) return 'hoy';
  return `en ${dias} d`;
}

/** La versión legible, para el `title` y para las alertas del resumen. */
export function plazoLargo(vigencia: HrVigencia, dias?: number | null): string {
  if (vigencia === 'SIN_VENCIMIENTO') return 'Este registro no tiene vencimiento.';
  if (vigencia === 'SIN_FECHA') return 'Todavía no se cargó la fecha de vencimiento.';
  if (dias === null || dias === undefined) return '';
  if (dias < 0) {
    const d = -dias;
    return `Venció hace ${d} ${d === 1 ? 'día' : 'días'}.`;
  }
  if (dias === 0) return 'Vence hoy.';
  return `Vence en ${dias} ${dias === 1 ? 'día' : 'días'}.`;
}

/** Fecha ISO a dd-mm-aaaa sin pasar por `Date`, que correría el día por zona. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}-${m}-${a}` : iso;
}

/** Iniciales para el avatar de respaldo. */
export function iniciales(firstName: string, lastName: string): string {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase();
}
