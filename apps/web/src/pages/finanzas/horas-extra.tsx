import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Ban,
  Check,
  Clock,
  DollarSign,
  Plus,
  RotateCw,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { useOvertime } from '@/hooks/use-overtime';
import { FinanceStatusBadge } from './finance-status-badge';
import { RejectDialog } from './reject-dialog';
import { formatDate } from '@/lib/format';
import type { CreateOvertimeInput } from '@/types/finance';

/** Helper to get today's date in YYYY-MM-DD local format. */
function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface NewOvertimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateOvertimeInput) => Promise<void>;
}

function NewOvertimeDialog({
  open,
  onOpenChange,
  onSubmit,
}: NewOvertimeDialogProps): ReactNode {
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(getTodayString());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setHours('');
      setDate(getTodayString());
      setReason('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    const parsedHours = parseFloat(hours);
    if (!hours || Number.isNaN(parsedHours) || parsedHours <= 0) {
      setError('Las horas deben ser un número mayor a cero.');
      return;
    }
    if (!date) {
      setError('La fecha es obligatoria.');
      return;
    }
    if (!reason.trim()) {
      setError('El motivo es obligatorio.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        hours: parsedHours,
        date,
        reason: reason.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Reportar horas extra</ModalTitle>
          <ModalDescription>
            Ingresa la fecha, cantidad de horas trabajadas y el motivo detallado de la jornada.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-hours">Horas trabajadas</Label>
              <Input
                id="ot-hours"
                type="number"
                min="0.1"
                step="0.1"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="Ej. 2.5"
                required
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-date">Fecha de trabajo</Label>
              <Input
                id="ot-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-reason">Motivo</Label>
            <textarea
              id="ot-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica el trabajo realizado durante estas horas extra."
              rows={3}
              required
              disabled={submitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={submitting}>
              Enviar solicitud
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

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
    return (
      <div className="flex animate-pulse flex-col gap-3" aria-hidden>
        <div className="h-10 rounded-md border border-border bg-muted/40" />
        <div className="h-14 rounded-md border border-border bg-muted/40" />
        <div className="h-14 rounded-md border border-border bg-muted/40" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-12 text-center"
      >
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <p className="max-w-sm text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RotateCw aria-hidden />
          Reintentar
        </Button>
      </div>
    );
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
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-12 text-center">
            <Clock className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Aún no tienes solicitudes de horas extra registradas.</p>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden />
              Nueva solicitud
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-card">
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
                    <TableCell className="font-semibold">{item.hours} hrs</TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate" title={item.reason}>
                      {item.reason}
                    </TableCell>
                    <TableCell>
                      <FinanceStatusBadge status={item.status} />
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
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
              <p className="text-sm">No hay solicitudes de horas extra pendientes ni registradas en el sistema.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card">
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
                        <TableCell className="font-semibold">{item.hours} hrs</TableCell>
                        <TableCell className="max-w-xs truncate" title={item.reason}>
                          {item.reason}
                        </TableCell>
                        <TableCell>
                          <FinanceStatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status === 'PENDIENTE' && (
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

      <NewOvertimeDialog
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
        onConfirm={async (reason) => {
          if (actioning) return;
          if (rejectTargetId) {
            setActioning(rejectTargetId);
            try {
              await reject(rejectTargetId, reason);
              toast.success('Solicitud rechazada.');
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Error al rechazar solicitud.');
              throw err;
            } finally {
              setActioning(null);
            }
          }
        }}
      />
    </div>
  );
}
