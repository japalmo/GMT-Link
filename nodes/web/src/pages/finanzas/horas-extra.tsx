import { useCallback, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Ban,
  Check,
  Clock,
  DollarSign,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { RejectDialog } from '@/components/ui/reject-dialog';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
} from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useOvertime } from '@/hooks/use-overtime';
import { errorToMessage, fetchOvertimeTable } from '@/lib/api';
import type { TableRequest } from '@gmt-platform/contracts';
import { formatDate, formatHours } from '@/lib/format';
import type { OvertimeView } from '@/types/finance';
import { HorasExtraFormDialog } from './horas-extra-form';

export function HorasExtraTab(): ReactNode {
  const {
    mine,
    mineHasMore,
    loadingMoreMine,
    loadMoreMine,
    isManager,
    loading,
    error,
    refetch,
    create,
    update,
    remove,
    approve,
    reject,
    pay,
  } = useOvertime();

  // MOTOR de tablas de Gestión (offset). Solo consulta si el usuario es gestor
  // (enabled=isManager); un no-gestor nunca dispara el 403 del endpoint.
  const managerFetcher = useCallback((req: TableRequest) => fetchOvertimeTable(req), []);
  const managerTable = useDataTable<OvertimeView>(managerFetcher, {
    enabled: isManager,
    initialSortBy: 'fecha',
    initialSortDir: 'desc',
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OvertimeView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OvertimeView | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      await approve(id);
      managerTable.refetch();
      toast.success('Horas extra aprobadas con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aprobar horas extra.');
    } finally {
      setActioning(null);
    }
  };

  const handlePay = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      await pay(id);
      managerTable.refetch();
      toast.success('Pago registrado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar pago.');
    } finally {
      setActioning(null);
    }
  };

  // Columnas / filtro / acciones de la tabla de Gestión (motor server-side).
  const managerColumns: ReadonlyArray<DataTableColumn<OvertimeView>> = [
    {
      id: 'solicitante',
      header: 'Solicitante',
      sortable: true,
      render: (item) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">
            {item.requester ? `${item.requester.firstName} ${item.requester.lastName}` : 'Sin solicitante'}
          </span>
          <span className="text-xs text-muted-foreground">{item.requester?.email}</span>
        </div>
      ),
    },
    { id: 'fecha', header: 'Fecha', sortable: true, render: (item) => formatDate(item.date) },
    {
      id: 'horas',
      header: 'Horas',
      sortable: true,
      render: (item) => (
        <span className="font-semibold">{item.hours != null ? formatHours(item.hours) : 'Sin cierre'}</span>
      ),
    },
    {
      id: 'motivo',
      header: 'Motivo',
      className: 'max-w-xs truncate',
      render: (item) => <span title={item.reason ?? undefined}>{item.reason ?? 'Sin motivo'}</span>,
    },
    {
      id: 'estado',
      header: 'Estado',
      sortable: true,
      render: (item) =>
        item.isDraft ? (
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Borrador
          </span>
        ) : (
          <StatusBadge type="finance" status={item.status} />
        ),
    },
  ];

  const managerStatusFilter: DataTableFilter = {
    id: 'status',
    label: 'Estado',
    allLabel: 'Todos los estados',
    options: [
      { value: 'PENDIENTE', label: 'Pendiente' },
      { value: 'APROBADO', label: 'Aprobado' },
      { value: 'PAGADO', label: 'Pagado' },
      { value: 'RECHAZADO', label: 'Rechazado' },
    ],
  };

  const managerRowActions = (item: OvertimeView): ReactNode => (
    <>
      {item.status === 'PENDIENTE' && !item.isDraft && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10"
            onClick={() => void handleApprove(item.id)}
            disabled={actioning !== null}
          >
            {actioning === item.id ? (
              'Procesando...'
            ) : (
              <>
                <Check className="size-3.5" aria-hidden />
                Aprobar
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs text-destructive hover:bg-destructive/5"
            onClick={() => setRejectTargetId(item.id)}
            disabled={actioning !== null}
          >
            <Ban className="size-3.5" aria-hidden />
            Rechazar
          </Button>
        </>
      )}
      {item.status === 'APROBADO' && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-500/10"
          onClick={() => void handlePay(item.id)}
          disabled={actioning !== null}
        >
          {actioning === item.id ? (
            'Procesando...'
          ) : (
            <>
              <DollarSign className="size-3.5" aria-hidden />
              Registrar Pago
            </>
          )}
        </Button>
      )}
      {(item.status === 'PAGADO' || item.status === 'RECHAZADO') && (
        <span className="text-xs italic text-muted-foreground">Completado</span>
      )}
    </>
  );

  if (loading) {
    return <LoadingState rows={4} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Sección Mis Solicitudes */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Mis Horas Extra</h2>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            Reportar Horas Extra
          </Button>
        </div>

        {mine.length === 0 ? (
          <EmptyState
            icon={Clock}
            message="Aún no tienes solicitudes de horas extra registradas."
            action={
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden />
                Nueva solicitud
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Horas</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDate(item.date)}</TableCell>
                    <TableCell className="font-semibold">
                      {item.hours != null ? formatHours(item.hours) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate" title={item.reason ?? undefined}>
                      {item.reason ?? '—'}
                    </TableCell>
                    <TableCell>
                      {item.isDraft ? (
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Borrador
                        </span>
                      ) : (
                        <StatusBadge type="finance" status={item.status} />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {item.status === 'PENDIENTE' ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setEditTarget(item)}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs text-destructive hover:bg-destructive/5"
                              onClick={() => setDeleteTarget(item)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              Borrar
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Paginación server-side: carga la siguiente página al final de "Mis Horas Extra". */}
        {mineHasMore && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void loadMoreMine()} disabled={loadingMoreMine}>
              {loadingMoreMine ? 'Cargando…' : 'Cargar más'}
            </Button>
          </div>
        )}
      </section>

      {/* Sección de Gestión */}
      {isManager && (
        <section className="flex flex-col gap-4">
          <div className="border-t border-border pt-6">
            <h2 className="text-lg font-semibold tracking-tight">Gestión de Horas Extra</h2>
            <p className="text-sm text-muted-foreground">Aprobación, rechazo y pago de horas extra de la organización.</p>
          </div>

          <DataTable<OvertimeView>
            table={managerTable}
            columns={managerColumns}
            getRowId={(item) => item.id}
            filters={[managerStatusFilter]}
            rowActions={managerRowActions}
            emptyMessage="No hay solicitudes de horas extra pendientes ni registradas en el sistema."
            caption="Gestión de horas extra"
          />
        </section>
      )}

      <HorasExtraFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={create}
      />

      <HorasExtraFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        onSubmit={create}
        initial={editTarget ?? undefined}
        onUpdate={update}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Borrar horas extra"
        description="Se eliminará esta solicitud de horas extra de forma permanente. Esta acción no se puede deshacer."
        confirmLabel="Borrar"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await remove(deleteTarget.id);
        }}
      />

      <RejectDialog
        open={rejectTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTargetId(null);
        }}
        title="Rechazar solicitud de horas extra"
        reasonRequired={false}
        onConfirm={async (reason) => {
          if (!rejectTargetId) return;
          setActioning(rejectTargetId);
          try {
            await reject(rejectTargetId, reason);
            managerTable.refetch();
            toast.success('Solicitud rechazada.');
          } catch (err) {
            throw new Error(errorToMessage(err, 'Error al rechazar solicitud.'));
          } finally {
            setActioning(null);
          }
        }}
      />
    </div>
  );
}
