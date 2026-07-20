import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Ban, Check, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  approveOvertime,
  downloadOvertimeMonthlyReport,
  listAllOvertime,
  rejectOvertime,
} from '@/lib/api';
import { formatDate, formatHours } from '@/lib/format';
import { currentAccountingMonth } from '@/lib/santiago-time';
import type { OvertimeView } from '@/types/finance';

/** Trae TODAS las HE pendientes (no borrador) del mes, paginando el keyset. */
async function fetchAllPending(month: string): Promise<OvertimeView[]> {
  const out: OvertimeView[] = [];
  let cursor: string | undefined;
  // Tope defensivo por si el cursor no avanza (no debería): máx. 20 páginas de 100.
  for (let i = 0; i < 20; i += 1) {
    const page = await listAllOvertime({ status: 'PENDIENTE', month, limit: 100, cursor });
    // Un borrador no es aprobable: fuera del cierre.
    out.push(...page.items.filter((o) => !o.isDraft));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

function workerName(o: OvertimeView): string {
  return o.requester ? `${o.requester.firstName} ${o.requester.lastName}` : 'Sin solicitante';
}

export interface MonthlyReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras cada aprobación/rechazo para refrescar la tabla de Gestión. */
  onResolved: () => void;
}

/**
 * Cierre mensual de Horas Extra: el admin de contrato elige el período, resuelve
 * (aprueba/rechaza) las pendientes y descarga el Excel de las APROBADAS del mes.
 */
export function MonthlyReportDialog({
  open,
  onOpenChange,
  onResolved,
}: MonthlyReportDialogProps): ReactNode {
  const [month, setMonth] = useState<string>(() => currentAccountingMonth());
  const [pending, setPending] = useState<OvertimeView[]>([]);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Guarda de generación: si el usuario cambia de mes mientras carga, una respuesta
  // vieja que llegue tarde NO debe pisar la lista del mes nuevo.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqIdRef.current;
    setLoading(true);
    try {
      const rows = await fetchAllPending(month);
      if (reqIdRef.current === id) setPending(rows);
    } catch (err) {
      if (reqIdRef.current === id) {
        toast.error(err instanceof Error ? err.message : 'No se pudieron cargar las solicitudes.');
        setPending([]);
      }
    } finally {
      if (reqIdRef.current === id) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const busy = actioning !== null || bulkRunning || downloading;

  const approveOne = async (id: string): Promise<void> => {
    setActioning(id);
    try {
      await approveOvertime(id);
      setPending((p) => p.filter((o) => o.id !== id));
      onResolved();
      toast.success('Horas extra aprobadas.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo aprobar.');
    } finally {
      setActioning(null);
    }
  };

  const approveAll = async (): Promise<void> => {
    if (pending.length === 0) return;
    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    // Secuencial: cada aprobación es independiente; una que falle (p. ej. propia,
    // maker-checker) no aborta el resto.
    for (const o of pending) {
      try {
        await approveOvertime(o.id);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    onResolved();
    await load();
    setBulkRunning(false);
    if (fail === 0) toast.success(`${ok} solicitud${ok === 1 ? '' : 'es'} aprobada${ok === 1 ? '' : 's'}.`);
    else toast.warning(`${ok} aprobadas, ${fail} no se pudieron aprobar (revisa el detalle).`);
  };

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await downloadOvertimeMonthlyReport(month);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `horas-extra-${month}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Reporte generado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar el reporte.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Modal open={open && rejectTargetId === null} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
        <ModalContent className="max-w-2xl">
          <ModalHeader>
            <ModalTitle>
              <FileSpreadsheet className="inline size-5 mr-1.5 -mt-0.5 text-primary" aria-hidden />
              Cierre mensual de Horas Extra
            </ModalTitle>
            <ModalDescription>
              Resuelve las solicitudes pendientes del período y descarga el Excel de las
              aprobadas (totalizado por trabajador + detalle).
            </ModalDescription>
          </ModalHeader>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Período (mes contable, cierre día 20)</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || currentAccountingMonth())}
                disabled={busy}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            {pending.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void approveAll()}
                disabled={busy}
              >
                {bulkRunning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                Aprobar todas ({pending.length})
              </Button>
            )}
          </div>

          <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando pendientes…
              </div>
            ) : pending.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No hay solicitudes de horas extra pendientes en este período.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {pending.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{workerName(o)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(o.date)} · {o.startTime ?? '—'}–{o.endTime ?? '—'} ·{' '}
                        {o.hours != null ? formatHours(o.hours) : 'sin cierre'} extra
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-destructive hover:bg-destructive/5"
                        onClick={() => setRejectTargetId(o.id)}
                        disabled={busy}
                      >
                        <Ban className="size-3.5" aria-hidden /> Rechazar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => void approveOne(o.id)}
                        disabled={busy}
                      >
                        {actioning === o.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Check className="size-3.5" aria-hidden />
                        )}
                        Aprobar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cerrar
              </Button>
            </ModalClose>
            {pending.length > 0 && (
              <span className="mr-auto self-center text-xs text-amber-600 dark:text-amber-500">
                Quedan {pending.length} pendiente{pending.length === 1 ? '' : 's'} sin resolver.
              </span>
            )}
            <Button type="button" onClick={() => void handleDownload()} loading={downloading} disabled={actioning !== null || bulkRunning}>
              <Download className="size-4" aria-hidden /> Descargar Excel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <RejectDialog
        open={rejectTargetId !== null}
        onOpenChange={(o) => {
          if (!o) setRejectTargetId(null);
        }}
        title="Rechazar solicitud de horas extra"
        reasonRequired={false}
        onConfirm={async (reason) => {
          if (!rejectTargetId) return;
          const id = rejectTargetId;
          // Éxito: RejectDialog cierra vía onOpenChange(false) (limpia rejectTargetId).
          // Fallo: se relanza para que el RejectDialog muestre el error inline y NO se
          // cierre (por eso NO se limpia rejectTargetId acá).
          try {
            await rejectOvertime(id, reason);
            setPending((p) => p.filter((o) => o.id !== id));
            onResolved();
            toast.success('Solicitud rechazada.');
          } catch (err) {
            throw new Error(err instanceof Error ? err.message : 'No se pudo rechazar.');
          }
        }}
      />
    </>
  );
}
