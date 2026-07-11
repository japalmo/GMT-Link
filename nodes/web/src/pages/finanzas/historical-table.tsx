import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCLP, formatDate } from '@/lib/format';
import type { FinanceRow, OverviewFilters } from '@/types/finance';

/** Opción de tamaño de página. `0` = todas. */
type PageSize = 0 | 20 | 50 | 100;

export interface HistoricalTableProps {
  /** Filas ya filtradas y ordenadas (el caller aplica `filterRows`). */
  rows: FinanceRow[];
  filters: OverviewFilters;
  onFiltersChange: (next: OverviewFilters) => void;
  /** Trabajadores para el filtro (sólo si hay acceso a todos). */
  workers: Array<{ id: string; name: string }>;
  /** Proyectos para el filtro. */
  projects: Array<{ id: string; name: string }>;
  /** Clientes para el filtro (sólo HE). Derivados de las filas SIN filtrar por el caller. */
  clients: Array<{ id: string; name: string }>;
  /** Muestra el filtro por trabajador (gateado por permiso por el caller). */
  showWorkerFilter: boolean;
  /** Clic en una fila (abre detalle). */
  onRowClick?: (row: FinanceRow) => void;
}

export function HistoricalTable({
  rows,
  filters,
  onFiltersChange,
  workers,
  projects,
  clients,
  showWorkerFilter,
  onRowClick,
}: HistoricalTableProps): ReactNode {
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [page, setPage] = useState(0);

  const set = (patch: Partial<OverviewFilters>): void => {
    setPage(0);
    onFiltersChange({ ...filters, ...patch });
  };

  const total = rows.length;
  const size = pageSize === 0 ? total || 1 : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clampedPage = Math.min(page, pageCount - 1);
  const visible =
    pageSize === 0 ? rows : rows.slice(clampedPage * size, clampedPage * size + size);

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showWorkerFilter && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-worker">Trabajador</Label>
            <Select
              id="hf-worker"
              aria-label="Filtrar por trabajador"
              value={filters.requesterId ?? ''}
              onChange={(e) => set({ requesterId: e.target.value || null })}
            >
              <option value="">Todos</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-project">Proyecto (HE)</Label>
          <Select
            id="hf-project"
            aria-label="Filtrar por proyecto"
            value={filters.projectId ?? ''}
            onChange={(e) => set({ projectId: e.target.value || null })}
          >
            <option value="">Todos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-client">Cliente (HE)</Label>
          <Select
            id="hf-client"
            aria-label="Filtrar por cliente"
            value={filters.clientId ?? ''}
            onChange={(e) => set({ clientId: e.target.value || null })}
          >
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-datemode">Fecha</Label>
          <Select
            id="hf-datemode"
            aria-label="Modo de filtro por fecha"
            value={filters.dateMode}
            onChange={(e) =>
              set({
                dateMode: e.target.value as OverviewFilters['dateMode'],
                dateFrom: null,
                dateTo: null,
                month: null,
              })
            }
          >
            <option value="none">Sin filtro</option>
            <option value="month">Por mes (cierre 20)</option>
            <option value="exact">Exacta</option>
            <option value="before">Antes de</option>
            <option value="after">Después de</option>
            <option value="between">Entre</option>
          </Select>
        </div>

        {filters.dateMode === 'month' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-month">Mes</Label>
            <Input
              id="hf-month"
              type="month"
              value={filters.month ?? ''}
              onChange={(e) => set({ month: e.target.value || null })}
            />
          </div>
        )}
        {(filters.dateMode === 'exact' ||
          filters.dateMode === 'before' ||
          filters.dateMode === 'after' ||
          filters.dateMode === 'between') && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-from">
              {filters.dateMode === 'between' ? 'Desde' : 'Fecha'}
            </Label>
            <Input
              id="hf-from"
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(e) => set({ dateFrom: e.target.value || null })}
            />
          </div>
        )}
        {filters.dateMode === 'between' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hf-to">Hasta</Label>
            <Input
              id="hf-to"
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(e) => set({ dateTo: e.target.value || null })}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hf-order">Orden por fecha</Label>
          <Select
            id="hf-order"
            aria-label="Orden por fecha"
            value={filters.order}
            onChange={(e) => set({ order: e.target.value as 'asc' | 'desc' })}
          >
            <option value="desc">Más reciente primero</option>
            <option value="asc">Más antigua primero</option>
          </Select>
        </div>
      </div>

      {/* Tabla */}
      {total === 0 ? (
        <EmptyState message="No hay solicitudes que coincidan con el filtro." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Trabajador</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Monto / Horas</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow
                  key={`${r.kind}-${r.id}`}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  onClick={() => onRowClick?.(r)}
                >
                  <TableCell>{formatDate(r.date)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.kind === 'REEMBOLSO' ? 'Reembolso' : 'Horas extra'}
                  </TableCell>
                  <TableCell className="font-medium">{r.requesterName}</TableCell>
                  <TableCell className="max-w-xs truncate" title={r.description}>
                    {r.description}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.projectName ?? '—'}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.kind === 'REEMBOLSO'
                      ? formatCLP(r.amount ?? 0)
                      : r.hours != null
                        ? `${r.hours} hrs`
                        : '—'}
                  </TableCell>
                  <TableCell>
                    {r.isDraft ? (
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Borrador
                      </span>
                    ) : (
                      <StatusBadge type="finance" status={r.status} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Paginación */}
      <div className="flex items-center justify-end gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Label htmlFor="hf-pagesize" className="text-muted-foreground">
            Por página
          </Label>
          <Select
            id="hf-pagesize"
            aria-label="Filas por página"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as PageSize);
              setPage(0);
            }}
            className="w-auto"
          >
            <option value="0">Todas</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </Select>
        </div>
        {pageSize !== 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Anterior"
              disabled={clampedPage === 0}
              onClick={() => setPage(clampedPage - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="tabular-nums text-muted-foreground">
              {clampedPage + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Siguiente"
              disabled={clampedPage >= pageCount - 1}
              onClick={() => setPage(clampedPage + 1)}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
