import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { useReimbursements } from '@/hooks/use-reimbursements';
import { useOvertime } from '@/hooks/use-overtime';
import { useHasPermission } from '@/hooks/use-has-permission';
import { useFinanceProjects } from './use-finance-projects';
import { toFinanceRows, filterRows } from './finance-overview';
import { currentAccountingMonth } from '@/lib/santiago-time';
import { OverviewCards } from './overview-cards';
import { HistoricalTable } from './historical-table';
import { RequestDetailDialog } from './request-detail-dialog';
import type { FinanceRow, OverviewFilters } from '@/types/finance';

function initialFilters(): OverviewFilters {
  return {
    requesterId: null,
    dateMode: 'month',
    dateFrom: null,
    dateTo: null,
    month: currentAccountingMonth(),
    projectId: null,
    clientId: null,
    order: 'desc',
  };
}

/**
 * Vista general de Finanzas (§5.2/§5.3). Reutiliza los hooks de datos existentes:
 * para gestores usa `managerItems` (probe backend), para trabajador `mine`. Las
 * cards se recalculan a partir de las filas FILTRADAS. Clic en una fila abre el
 * detalle; si el permiso lo habilita, permite aprobar/rechazar (alertas §5.2).
 * Arranca filtrada al mes contable en curso.
 */
export function VistaGeneralTab(): ReactNode {
  // La Vista general agrega client-side sobre TODO lo cargado (cards, ranking,
  // tabla histórica con su propia paginación interna): a diferencia de las
  // pestañas de Reembolsos/Horas extra (que solo necesitan una página con
  // "Cargar más"), acá se pide la página más grande permitida (tope 100) para
  // acercarse al comportamiento previo de "cargar todo". Con más de 100
  // solicitudes de un mismo tipo, la Vista general queda acotada a las 100 más
  // recientes hasta que se implemente agregación server-side.
  const reimb = useReimbursements({ limit: 100 });
  const ot = useOvertime({ limit: 100 });
  const { projects } = useFinanceProjects();

  const canViewAll = useHasPermission('finance:request:view:all');
  const canApprove = useHasPermission('finance:request:approve');

  const [filters, setFilters] = useState<OverviewFilters>(initialFilters);
  const [detail, setDetail] = useState<FinanceRow | null>(null);

  const hasAllAccess = canViewAll || reimb.isManager || ot.isManager;

  // Fuente de datos por tipo: managerItems si soy gestor de ese tipo, si no, lo mío.
  const reimbRows = reimb.isManager ? reimb.managerItems : reimb.mine;
  const otRows = ot.isManager ? ot.managerItems : ot.mine;

  const allRows = useMemo(
    () => toFinanceRows(reimbRows, otRows, projects),
    [reimbRows, otRows, projects],
  );
  const filtered = useMemo(() => filterRows(allRows, filters), [allRows, filters]);

  // Solicitudes pendientes de resolución (no borradores) para las alertas.
  const pending = useMemo(
    () => filtered.filter((r) => r.status === 'PENDIENTE' && !r.isDraft),
    [filtered],
  );

  const workers = useMemo(() => {
    const map = new Map<string, string>();
    allRows.forEach((r) => map.set(r.requesterId, r.requesterName));
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  // Clientes derivados de las filas SIN filtrar → el filtro no se colapsa al elegir uno.
  const clients = useMemo(() => {
    const map = new Map<string, string>();
    allRows.forEach((r) => {
      if (r.clientId && r.clientName) map.set(r.clientId, r.clientName);
    });
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  const loading = reimb.loading || ot.loading;
  const error = reimb.error ?? ot.error;

  // Las derivaciones (cards, rankings, alertas) se calculan client-side sobre lo
  // cargado (tope 100 por tipo). Si hay más de una página, avisamos que los
  // agregados quedan acotados a las 100 más recientes (hasta agregación server-side).
  const dataTruncated =
    (reimb.isManager ? reimb.managerHasMore : reimb.mineHasMore) ||
    (ot.isManager ? ot.managerHasMore : ot.mineHasMore);

  const handleApprove = async (row: FinanceRow): Promise<void> => {
    try {
      if (row.kind === 'REEMBOLSO') await reimb.approve(row.id);
      else await ot.approve(row.id);
      toast.success('Solicitud aprobada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo aprobar.');
      throw err;
    }
  };

  const handleReject = async (row: FinanceRow, reason?: string): Promise<void> => {
    try {
      if (row.kind === 'REEMBOLSO') await reimb.reject(row.id, reason);
      else await ot.reject(row.id, reason);
      toast.success('Solicitud rechazada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo rechazar.');
      throw err;
    }
  };

  if (loading) return <LoadingState rows={6} />;
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          void reimb.refetch();
          void ot.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <OverviewCards rows={filtered} hasAllAccess={hasAllAccess} />

      {dataTruncated && (
        <Card className="flex items-center gap-2 border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            Estás viendo las 100 solicitudes más recientes por tipo. Los totales, rankings
            y alertas pueden quedar incompletos si el período tiene más.
          </span>
        </Card>
      )}

      {/* Alertas: solicitudes pendientes → clic abre detalle */}
      {canApprove && pending.length > 0 && (
        <Card className="flex flex-col gap-2 border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" aria-hidden />
            {pending.length} solicitud{pending.length === 1 ? '' : 'es'} pendiente
            {pending.length === 1 ? '' : 's'} de resolución
          </div>
          <ul className="flex flex-wrap gap-2">
            {pending.slice(0, 8).map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <button
                  type="button"
                  className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:border-primary/50"
                  onClick={() => setDetail(r)}
                >
                  {r.requesterName} · {r.kind === 'REEMBOLSO' ? 'Reembolso' : 'HE'}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <HistoricalTable
        rows={filtered}
        filters={filters}
        onFiltersChange={setFilters}
        workers={workers}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        clients={clients}
        showWorkerFilter={hasAllAccess}
        onRowClick={(r) => setDetail(r)}
      />

      <RequestDetailDialog
        row={detail}
        onClose={() => setDetail(null)}
        canApprove={canApprove}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
