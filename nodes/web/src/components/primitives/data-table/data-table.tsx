import { useId, type ReactNode } from 'react';
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
import type { UseDataTableResult } from '@/hooks/use-data-table';

/** Opciones del selector de filas por página. `all` pide el máximo del backend. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 'all'] as const;
/** Valor de `pageSize` que representa "Todos" (tope duro del backend). */
export const PAGE_SIZE_ALL = 200;

/** Definición de una columna de {@link DataTable} (server-side). */
export interface DataTableColumn<T> {
  /** Id único (clave de React). */
  readonly id: string;
  /** Encabezado visible. */
  readonly header: ReactNode;
  /** Render de la celda. */
  readonly render: (item: T) => ReactNode;
  /** Si la columna se puede ordenar en el server. Requiere `sortKey` (o usa `id`). */
  readonly sortable?: boolean;
  /** Clave de orden que viaja al backend (default: `id`). */
  readonly sortKey?: string;
  /** Clase de la celda/encabezado. */
  readonly className?: string;
}

/** Filtro select server-side: el valor elegido viaja como `filters[id]` al backend. */
export interface DataTableFilter {
  readonly id: string;
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly allLabel?: string;
}

export interface DataTableProps<T> {
  /** Estado y datos del hook {@link useDataTable}. */
  readonly table: UseDataTableResult<T>;
  readonly columns: ReadonlyArray<DataTableColumn<T>>;
  readonly getRowId: (item: T) => string;
  readonly searchable?: boolean;
  readonly searchPlaceholder?: string;
  readonly filters?: ReadonlyArray<DataTableFilter>;
  readonly rowActions?: (item: T) => ReactNode;
  readonly rowActionsLabel?: string;
  readonly onRowClick?: (item: T) => void;
  readonly emptyMessage?: string;
  readonly caption?: string;
  readonly className?: string;
}

/**
 * Motor de tabla server-side unificado. Búsqueda, filtros, orden y paginación se
 * resuelven en el backend (vía {@link useDataTable}) sobre el dataset COMPLETO, no
 * solo la página cargada. Paginación por offset con páginas numeradas + selector de
 * filas por página. Reutilizable en todos los módulos.
 */
export function DataTable<T>({
  table,
  columns,
  getRowId,
  searchable = false,
  searchPlaceholder = 'Buscar…',
  filters,
  rowActions,
  rowActionsLabel = 'Acciones',
  onRowClick,
  emptyMessage = 'No hay elementos para mostrar.',
  caption,
  className,
}: DataTableProps<T>): ReactNode {
  const baseId = useId();
  const { items, total, page, pageSize, pageCount, loading, error } = table;
  const activeFilters = filters ?? [];
  const totalColumns = columns.length + (rowActions ? 1 : 0);
  const showEmpty = !loading && !error && total === 0;
  const showTable = !error;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Barra de controles: búsqueda + filtros + selector de filas por página (siempre visible). */}
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
                  value={table.search}
                  placeholder={searchPlaceholder}
                  onChange={(e) => table.setSearch(e.target.value)}
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
                  )}
                  value={table.filters[filter.id] ?? ''}
                  onChange={(e) => table.setFilter(filter.id, e.target.value || undefined)}
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

          {/* Selector de filas por página: siempre visible, a la derecha. */}
          <div className="flex flex-col gap-1.5 sm:ml-auto">
            <Label htmlFor={`${baseId}-pagesize`}>Por página</Label>
            <PageSizeSelect
              id={`${baseId}-pagesize`}
              value={pageSize}
              onChange={(size) => table.setPageSize(size)}
            />
          </div>
      </div>

      {error ? (
        <DtErrorState message={error} onRetry={table.refetch} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            {caption && <caption className="sr-only">{caption}</caption>}
            <TableHeader>
              <TableRow>
                {columns.map((column) => {
                  const canSort = Boolean(column.sortable);
                  const sortKey = column.sortKey ?? column.id;
                  const isSorted = canSort && table.sortBy === sortKey;
                  return (
                    <TableHead key={column.id} className={column.className}>
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => table.toggleSort(sortKey)}
                          aria-label={`Ordenar por ${typeof column.header === 'string' ? column.header : column.id}`}
                          className={cn(
                            'group -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors',
                            'hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          )}
                        >
                          {column.header}
                          <DtSortIcon active={isSorted} direction={isSorted ? table.sortDir : undefined} />
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
                Array.from({ length: 5 }).map((_, rowIndex) => (
                  <TableRow key={`skeleton-${rowIndex}`} aria-hidden>
                    {Array.from({ length: totalColumns }).map((__, cellIndex) => (
                      <TableCell key={`skeleton-${rowIndex}-${cellIndex}`}>
                        <div className="h-4 w-full max-w-[12rem] animate-pulse rounded bg-muted" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!loading &&
                showTable &&
                items.map((item) => (
                  <TableRow
                    key={getRowId(item)}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                    onClick={onRowClick ? () => onRowClick(item) : undefined}
                  >
                    {columns.map((column) => (
                      <TableCell key={column.id} className={column.className}>
                        {column.render(item)}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">{rowActions(item)}</div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}

              {!loading && showEmpty && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={totalColumns} className="p-0">
                    <DtEmptyState message={emptyMessage} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!error && total > 0 && (
        <nav
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Paginación"
        >
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Mostrando {from}-{to} de {total}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-1">
              <Button variant="outline" size="sm" onClick={() => table.setPage(page - 1)} disabled={page <= 1} aria-label="Página anterior">
                <ChevronLeft aria-hidden />
              </Button>
              {pageNumbers(page, pageCount).map((n, i) =>
                n === '…' ? (
                  <span key={`gap-${i}`} className="px-1 text-sm text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={n}
                    variant={n === page ? 'default' : 'outline'}
                    size="sm"
                    className="min-w-9"
                    onClick={() => table.setPage(n)}
                    aria-current={n === page ? 'page' : undefined}
                  >
                    {n}
                  </Button>
                ),
              )}
              <Button variant="outline" size="sm" onClick={() => table.setPage(page + 1)} disabled={page >= pageCount} aria-label="Página siguiente">
                <ChevronRight aria-hidden />
              </Button>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}

/** Selector de filas por página (10/25/50/100/Todos). */
export function PageSizeSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: number;
  onChange: (size: number) => void;
}): ReactNode {
  const current = value >= PAGE_SIZE_ALL ? 'all' : String(value);
  return (
    <select
      id={id}
      className={cn(
        'flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors',
        'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
      value={current}
      onChange={(e) => onChange(e.target.value === 'all' ? PAGE_SIZE_ALL : Number(e.target.value))}
      aria-label="Filas por página"
    >
      {PAGE_SIZE_OPTIONS.map((opt) => (
        <option key={String(opt)} value={String(opt)}>
          {opt === 'all' ? `Máx. (${PAGE_SIZE_ALL})` : opt}
        </option>
      ))}
    </select>
  );
}

/** Genera la ventana de números de página con elipsis (1 … p-1 p p+1 … N). */
function pageNumbers(page: number, pageCount: number): Array<number | '…'> {
  const out: Array<number | '…'> = [];
  const push = (n: number): void => {
    if (!out.includes(n)) out.push(n);
  };
  const window = [page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount);
  push(1);
  if (window[0] !== undefined && window[0] > 2) out.push('…');
  for (const n of window) if (n !== 1 && n !== pageCount) push(n);
  const last = window[window.length - 1];
  if (last !== undefined && last < pageCount - 1) out.push('…');
  if (pageCount > 1) push(pageCount);
  return out;
}

function DtSortIcon({ active, direction }: { active: boolean; direction?: 'asc' | 'desc' }): ReactNode {
  if (!active) return <ChevronsUpDown className="size-3.5 opacity-50 transition-opacity group-hover:opacity-100" aria-hidden />;
  return direction === 'asc' ? (
    <ArrowUp className="size-3.5 text-foreground" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5 text-foreground" aria-hidden />
  );
}

function DtEmptyState({ message }: { message: string }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function DtErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-12 text-center">
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
