import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Ban,
  Check,
  Clock,
  DollarSign,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useOvertime } from '@/hooks/use-overtime';
import { errorToMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { HorasExtraFormDialog } from './horas-extra-form';

export function HorasExtraTab(): ReactNode {
  const {
    mine,
    managerItems,
    isManager,
    loading,
    error,
    refetch,
    create,
    approve,
    reject,
    pay,
  } = useOvertime();

  const [createOpen, setCreateOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      await approve(id);
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
      toast.success('Pago registrado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar pago.');
    } finally {
      setActioning(null);
    }
  };

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDate(item.date)}</TableCell>
                    <TableCell className="font-semibold">
                      {item.hours != null ? `${item.hours} hrs` : '—'}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

          {managerItems.length === 0 ? (
            <EmptyState message="No hay solicitudes de horas extra pendientes ni registradas en el sistema." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Solicitante</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Horas</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managerItems.map((item) => {
                    const name = item.requester
                      ? `${item.requester.firstName} ${item.requester.lastName}`
                      : '—';
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{name}</span>
                            <span className="text-xs text-muted-foreground">{item.requester?.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell className="font-semibold">
                          {item.hours != null ? `${item.hours} hrs` : '—'}
                        </TableCell>
                        <TableCell className="max-w-xs truncate" title={item.reason ?? undefined}>
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
                            {item.status === 'PENDIENTE' && !item.isDraft && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                                  onClick={() => void handleApprove(item.id)}
                                  disabled={actioning !== null}
                                >
                                  {actioning === item.id ? 'Procesando...' : (
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
                                className="h-8 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                                onClick={() => void handlePay(item.id)}
                                disabled={actioning !== null}
                              >
                                {actioning === item.id ? 'Procesando...' : (
                                  <>
                                    <DollarSign className="size-3.5" aria-hidden />
                                    Registrar Pago
                                  </>
                                )}
                              </Button>
                            )}
                            {(item.status === 'PAGADO' || item.status === 'RECHAZADO') && (
                              <span className="text-xs text-muted-foreground italic">Completado</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      <HorasExtraFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={create}
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
