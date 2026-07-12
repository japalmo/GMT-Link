import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  RotateCw,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** Valor primitivo apto para ordenar y buscar (sin `any`). */
export type ScalarValue = string | number;

/**
 * Definición de una columna de {@link RoleScopedList}.
 *
 * @typeParam T - El tipo de cada fila (agnóstico de dominio).
 */
export interface RoleScopedColumn<T> {
  /** Identificador único de la columna (clave de React y de ordenamiento). */
  readonly id: string;
  /** Encabezado visible de la columna. */
  readonly header: ReactNode;
  /** Render de la celda para una fila dada. */
  readonly render: (item: T) => ReactNode;
  /**
   * Si la columna admite ordenamiento asc/desc por su {@link RoleScopedColumn.accessor}.
   * Requiere `accessor` para tener efecto.
   */
  readonly sortable?: boolean;
  /**
   * Extrae un valor escalar de la fila para ordenar y para la búsqueda
   * client-side. Sin accessor, la columna no participa en búsqueda ni orden.
   */
  readonly accessor?: (item: T) => ScalarValue;
  /** Clase opcional para la celda (`<td>`) y su encabezado (`<th>`). */
  readonly className?: string;
}

/**
 * Filtro tipo select. La primitiva NO conoce la semántica: el consumidor provee
 * el {@link RoleScopedFilter.predicate} que decide si una fila pasa para el valor
 * seleccionado.
 *
 * @typeParam T - El tipo de cada fila.
 */
export interface RoleScopedFilter<T> {
  /** Identificador único del filtro. */
  readonly id: string;
  /** Etiqueta accesible del control. */
  readonly label: string;
  /** Opciones del select (el valor vacío `''` significa "todos"). */
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** Decide si `item` pasa el filtro para el `value` seleccionado. */
  readonly predicate: (item: T, value: string) => boolean;
  /** Placeholder de la opción "todos" (default: "Todos"). */
  readonly allLabel?: string;
}

type SortDirection = 'asc' | 'desc';

/**
 * Props de {@link RoleScopedList}.
 *
 * @typeParam T - El tipo de cada fila. La primitiva es genérica y reutilizable:
 * recibe los datos ya cargados y delega en el consumidor toda regla de negocio
 * (carga async, scoping por permisos vía OpenFGA, etc.).
 */
export interface RoleScopedListProps<T> {
  /** Datos ya cargados. La carga async la realiza el consumidor. */
  readonly items: readonly T[];
  /** Definición de columnas. */
  readonly columns: ReadonlyArray<RoleScopedColumn<T>>;
  /** Devuelve un id estable por fila (clave de React, no se renderiza). */
  readonly getRowId: (item: T) => string;
  /** Habilita el campo de búsqueda client-side sobre accessors de texto. */
  readonly searchable?: boolean;
  /** Placeholder del campo de búsqueda. */
  readonly searchPlaceholder?: string;
  /** Filtros select componibles. */
  readonly filters?: ReadonlyArray<RoleScopedFilter<T>>;
  /**
   * Scoping por permisos: las filas que devuelven `false` se ocultan (de ahí
   * "role-scoped"). El cálculo del permiso lo provee el consumidor (que sí
   * consulta OpenFGA); la primitiva no decide reglas (§3.1).
   */
  readonly canAccess?: (item: T) => boolean;
  /** Tamaño de página para la paginación client-side (default: 10). */
  readonly pageSize?: number;
  /** Estado de carga: muestra filas skeleton. */
  readonly loading?: boolean;
  /** Mensaje de error: muestra estado de error con botón de reintento. */
  readonly error?: string | null;
  /** Mensaje del estado vacío (sin items o todo filtrado). */
  readonly emptyMessage?: string;
  /** Callback del botón "Reintentar" en estado de error. */
  readonly onRetry?: () => void;
  /** Acciones por fila (botones), renderizadas en una columna final. */
  readonly rowActions?: (item: T) => ReactNode;
  /** Etiqueta accesible del encabezado de la columna de acciones. */
  readonly rowActionsLabel?: string;
  /** Texto accesible que describe la tabla (`<caption>` visualmente oculto). */
  readonly caption?: string;
  /** Clase opcional del contenedor raíz. */
  readonly className?: string;
}

function normalize(value: ScalarValue): string {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function compareScalar(a: ScalarValue, b: ScalarValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return normalize(a).localeCompare(normalize(b));
}

/**
 * Primitiva §5 — lista/tabla genérica filtrada por permisos del usuario.
 *
 * Reutilizable y agnóstica de dominio: se usará en Reembolsos, Horas, Proyectos,
 * Directorio, Insumos y Activos. Compone la `<Table />` del design system y
 * resuelve client-side búsqueda, filtros, ordenamiento y paginación sobre los
 * `items` ya cargados. Estados de carga / error / vacío siempre presentes.
 *
 * @typeParam T - El tipo de cada fila.
 */
export function RoleScopedList<T>({
  items,
  columns,
  getRowId,
  searchable = false,
  searchPlaceholder = 'Buscar…',
  filters,
  canAccess,
  pageSize = 10,
  loading = false,
  error = null,
  emptyMessage = 'No hay elementos para mostrar.',
  onRetry,
  rowActions,
  rowActionsLabel = 'Acciones',
  caption,
  className,
}: RoleScopedListProps<T>): ReactNode {
  const baseId = useId();
  const [query, setQuery] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(
    null,
  );
  const [page, setPage] = useState(1);

  const activeFilters = filters ?? [];
  const totalColumns = columns.length + (rowActions ? 1 : 0);

  // Columnas con accessor: base de búsqueda y ordenamiento.
  const searchableColumns = useMemo(
    () => columns.filter((c) => typeof c.accessor === 'function'),
    [columns],
  );

  // 1) Scoping por permisos → 2) búsqueda → 3) filtros.
  const filteredItems = useMemo(() => {
    const scoped = canAccess ? items.filter((item) => canAccess(item)) : items;

    const normalizedQuery = normalize(query.trim());
    const searched =
      searchable && normalizedQuery.length > 0
        ? scoped.filter((item) =>
            searchableColumns.some((col) => {
              const value = col.accessor?.(item);
              return value !== undefined && normalize(value).includes(normalizedQuery);
            }),
          )
        : scoped;

    return activeFilters.reduce<readonly T[]>((acc, filter) => {
      const value = filterValues[filter.id] ?? '';
      if (value === '') return acc;
      return acc.filter((item) => filter.predicate(item, value));
    }, searched);
  }, [
    items,
    canAccess,
    query,
    searchable,
    searchableColumns,
    activeFilters,
    filterValues,
  ]);

  // 4) Ordenamiento.
  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems;
    const column = columns.find((c) => c.id === sort.columnId);
    const accessor = column?.accessor;
    if (!accessor) return filteredItems;

    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filteredItems].sort(
      (a, b) => compareScalar(accessor(a), accessor(b)) * factor,
    );
  }, [filteredItems, sort, columns]);

  // 5) Paginación.
  const total = sortedItems.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageItems = sortedItems.slice(start, start + pageSize);

  function resetToFirstPage(): void {
    setPage(1);
  }

  function handleSearch(value: string): void {
    setQuery(value);
    resetToFirstPage();
  }

  function handleFilterChange(filterId: string, value: string): void {
    setFilterValues((prev) => ({ ...prev, [filterId]: value }));
    resetToFirstPage();
  }

  function toggleSort(columnId: string): void {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) {
        return { columnId, direction: 'asc' };
      }
      if (prev.direction === 'asc') return { columnId, direction: 'desc' };
      return null;
    });
    resetToFirstPage();
  }

  const hasControls = searchable || activeFilters.length > 0;
  const showEmpty = !loading && !error && total === 0;
  const showTable = !loading && !error && total > 0;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {hasControls && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {searchable && (
            <div className="flex flex-1 flex-col gap-1.5 sm:min-w-56">
              <Label htmlFor={`${baseId}-search`} className="sr-only">
                {searchPlaceholder}
              </Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id={`${baseId}-search`}
                  type="search"
                  className="pl-9"
                  value={query}
                  placeholder={searchPlaceholder}
                  onChange={(e) => handleSearch(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {activeFilters.map((filter) => {
            const selectId = `${baseId}-filter-${filter.id}`;
            return (
              <div key={filter.id} className="flex flex-col gap-1.5 sm:min-w-44">
                <Label htmlFor={selectId}>{filter.label}</Label>
                <select
                  id={selectId}
                  className={cn(
                    'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors',
                    'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                  value={filterValues[filter.id] ?? ''}
                  onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                  disabled={loading}
                >
                  <option value="">{filter.allLabel ?? 'Todos'}</option>
                  {filter.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            {caption && <caption className="sr-only">{caption}</caption>}
            <TableHeader>
              <TableRow>
                {columns.map((column) => {
                  const canSort = Boolean(column.sortable && column.accessor);
                  const isSorted = sort?.columnId === column.id;
                  return (
                    <TableHead key={column.id} className={column.className}>
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.id)}
                          disabled={loading}
                          aria-label={`Ordenar por ${
                            typeof column.header === 'string' ? column.header : column.id
                          }`}
                          className={cn(
                            'group -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors',
                            'hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            'disabled:cursor-not-allowed disabled:opacity-50',
                          )}
                        >
                          {column.header}
                          <SortIcon
                            active={isSorted}
                            direction={isSorted ? sort?.direction : undefined}
                          />
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
                {rowActions && (
                  <TableHead className="text-right">
                    <span className="sr-only">{rowActionsLabel}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading &&
                Array.from({ length: Math.min(pageSize, 5) }).map((_, rowIndex) => (
                  <TableRow key={`skeleton-${rowIndex}`} aria-hidden>
                    {Array.from({ length: totalColumns }).map((__, cellIndex) => (
                      <TableCell key={`skeleton-${rowIndex}-${cellIndex}`}>
                        <div className="h-4 w-full max-w-[12rem] animate-pulse rounded bg-muted" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {showTable &&
                pageItems.map((item) => (
                  <TableRow key={getRowId(item)}>
                    {columns.map((column) => (
                      <TableCell key={column.id} className={column.className}>
                        {column.render(item)}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">{rowActions(item)}</div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}

              {showEmpty && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={totalColumns} className="p-0">
                    <EmptyState message={emptyMessage} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {showTable && pageCount > 1 && (
        <Pagination
          page={safePage}
          pageCount={pageCount}
          total={total}
          start={start}
          shown={pageItems.length}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
        />
      )}
    </div>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction?: SortDirection;
}): ReactNode {
  if (!active) {
    return (
      <ChevronsUpDown
        className="size-3.5 opacity-50 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    );
  }
  return direction === 'asc' ? (
    <ArrowUp className="size-3.5 text-foreground" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5 text-foreground" aria-hidden />
  );
}

function EmptyState({ message }: { message: string }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): ReactNode {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-12 text-center"
    >
      <AlertCircle className="size-8 text-destructive" aria-hidden />
      <p className="max-w-sm text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          Reintentar
        </Button>
      )}
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  start,
  shown,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  shown: number;
  onPrev: () => void;
  onNext: () => void;
}): ReactNode {
  const from = total === 0 ? 0 : start + 1;
  const to = start + shown;
  return (
    <nav
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      aria-label="Paginación"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Mostrando {from}-{to} de {total}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft aria-hidden />
          Anterior
        </Button>
        <span className="text-sm text-muted-foreground" aria-current="page">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={page >= pageCount}
          aria-label="Página siguiente"
        >
          Siguiente
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
