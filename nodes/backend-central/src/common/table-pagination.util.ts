import type { SortDir, TablePage, TableRequest } from '@gmt-platform/contracts';

/**
 * Helpers del motor de tablas server-side (offset). Cada endpoint de lista compone
 * el WHERE (scope + búsqueda + filtros) y el ORDER BY con estos utilitarios y hace
 * `findMany` + `count` en paralelo, devolviendo un `TablePage<T>`. El shape de Prisma
 * es por-modelo, así que en vez de un helper genérico frágil se ofrecen piezas
 * tipadas que el endpoint ensambla.
 */

/** Tope duro de filas por página (protege la BD de un pageSize abusivo). */
export const MAX_TABLE_PAGE_SIZE = 200;

/** Normaliza `page`/`pageSize` del request y calcula `skip`/`take` para Prisma. */
export function tableSkipTake(req: TableRequest): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const rawSize = Math.trunc(Number(req.pageSize));
  const pageSize = Math.min(Math.max(Number.isFinite(rawSize) ? rawSize : 10, 1), MAX_TABLE_PAGE_SIZE);
  const rawPage = Math.trunc(Number(req.page));
  const page = Math.max(Number.isFinite(rawPage) ? rawPage : 1, 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** Normaliza la dirección de orden (default `desc`). */
export function tableSortDir(req: TableRequest): SortDir {
  return req.sortDir === 'asc' ? 'asc' : 'desc';
}

/**
 * Resuelve el `orderBy` de Prisma a partir de `sortBy`/`sortDir` contra un mapa de
 * columnas PERMITIDAS (clave de columna → factory que recibe la dirección). Si la
 * clave no está permitida o falta, devuelve `defaultOrder`. Esto evita ordenar por
 * campos arbitrarios y mantiene el orden determinístico.
 */
export function tableOrderBy<O>(
  req: TableRequest,
  sortMap: Record<string, (dir: SortDir) => O>,
  defaultOrder: O,
): O {
  const key = req.sortBy;
  if (key && Object.prototype.hasOwnProperty.call(sortMap, key)) {
    const factory = sortMap[key];
    if (factory) return factory(tableSortDir(req));
  }
  return defaultOrder;
}

/**
 * WHERE de búsqueda: `OR` de `contains` insensible sobre varios campos ESCALARES.
 * Devuelve `undefined` si no hay búsqueda (para no ensuciar el WHERE). Para buscar
 * sobre relaciones, el endpoint arma su propio `OR` y lo combina.
 */
export function tableSearchWhere<W>(search: string | undefined, fields: string[]): W | undefined {
  // El query string puede llegar anidado (qs): se coacciona a string para no
  // reventar con `.trim is not a function` ante un `search[x]=y` malicioso.
  const q = typeof search === 'string' ? search.trim() : '';
  if (!q || fields.length === 0) return undefined;
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } })) } as W;
}

/** Combina varios fragmentos de WHERE en un `AND` (ignora los `undefined`). */
export function tableAndWhere<W>(...parts: Array<W | undefined>): W | undefined {
  const defined = parts.filter((p): p is W => p !== undefined && p !== null);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  return { AND: defined } as W;
}

/** Empaqueta el resultado en la forma `TablePage<T>` del contrato. */
export function tablePage<T>(items: T[], total: number, page: number, pageSize: number): TablePage<T> {
  return { items, total, page, pageSize };
}
