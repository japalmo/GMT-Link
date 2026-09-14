/**
 * Estado de la consulta de RRHH, guardado en la dirección de la página.
 *
 * Vive en la URL y no en memoria por dos razones: al volver de una ficha los
 * filtros siguen puestos, y un enlace copiado muestra a quien lo abre la misma
 * consulta ("los vencidos de Capstone") sin tener que explicarle qué marcar.
 */

export type ModoConsulta = 'requisitos' | 'personas';

export const CLAVES_FILTRO = [
  'turno',
  'cliente',
  'faena',
  'tipo',
  'vigencia',
  'desde',
  'hasta',
  'sinCargo',
  'habilitante',
] as const;

export type ClaveFiltro = (typeof CLAVES_FILTRO)[number];

export type FiltrosConsulta = Partial<Record<ClaveFiltro, string>>;

export interface EstadoConsulta {
  modo: ModoConsulta;
  q: string;
  filtros: FiltrosConsulta;
}

export function leerConsulta(sp: URLSearchParams): EstadoConsulta {
  const filtros: FiltrosConsulta = {};
  for (const k of CLAVES_FILTRO) {
    const v = sp.get(k);
    if (v) filtros[k] = v;
  }
  return {
    modo: sp.get('modo') === 'personas' ? 'personas' : 'requisitos',
    q: sp.get('q') ?? '',
    filtros,
  };
}

/** Escribe la consulta sobre `sp` sin tocar los demás parámetros (sección, ficha). */
export function escribirConsulta(sp: URLSearchParams, c: EstadoConsulta): void {
  for (const k of CLAVES_FILTRO) {
    const v = c.filtros[k];
    if (v) sp.set(k, v);
    else sp.delete(k);
  }
  if (c.modo === 'personas') sp.set('modo', 'personas');
  else sp.delete('modo');
  if (c.q.trim()) sp.set('q', c.q);
  else sp.delete('q');
}

/** Filtros de selección múltiple, que viajan separados por coma. */
export function listaDe(v: string | undefined): string[] {
  return (v ?? '').split(',').filter(Boolean);
}

export function hayFiltros(c: EstadoConsulta): boolean {
  return c.q.trim() !== '' || Object.keys(c.filtros).length > 0;
}
