import { useState, type ReactNode } from 'react';
import { Ban, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { RejectDialog } from '@/components/ui/reject-dialog';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { formatCLP, formatDate, formatHours } from '@/lib/format';
import type { FinanceRow } from '@/types/finance';

export interface RequestDetailDialogProps {
  /** Fila a mostrar; `null` cierra el diálogo. */
  row: FinanceRow | null;
  onClose: () => void;
  /** Muestra las acciones aprobar/rechazar (gateado por permiso por el caller). */
  canApprove: boolean;
  onApprove: (row: FinanceRow) => Promise<void>;
  onReject: (row: FinanceRow, reason?: string) => Promise<void>;
}

/**
 * Detalle de una solicitud pendiente (§5.2 alertas). Muestra los datos y, si
 * `canApprove`, permite aprobar o abrir el `RejectDialog` para rechazar con
 * motivo. Un borrador de HE no es aprobable (badge "Borrador", sin acciones).
 */
export function RequestDetailDialog({
  row,
  onClose,
  canApprove,
  onApprove,
  onReject,
}: RequestDetailDialogProps): ReactNode {
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!row) return null;

  const handleApprove = async (): Promise<void> => {
    setBusy(true);
    try {
      await onApprove(row);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const isReimb = row.kind === 'REEMBOLSO';

  return (
    <>
      <Modal open={row !== null && !rejecting} onOpenChange={(o) => { if (!o) onClose(); }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {isReimb ? 'Reembolso' : 'Horas extra'}: {row.requesterName}
            </ModalTitle>
            <ModalDescription>{formatDate(row.date)}</ModalDescription>
          </ModalHeader>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Estado</dt>
              <dd>
                {row.isDraft ? (
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Borrador
                  </span>
                ) : (
                  <StatusBadge type="finance" status={row.status} />
                )}
              </dd>
            </div>
            {isReimb ? (
              <div>
                <dt className="text-muted-foreground">Monto</dt>
                <dd className="font-medium">{formatCLP(row.amount ?? 0)}</dd>
              </div>
            ) : row.isDraft ? (
              <div>
                <dt className="text-muted-foreground">Hora extra</dt>
                <dd className="font-medium">Borrador</dd>
              </div>
            ) : (
              <>
                {row.startTime && row.endTime && (
                  <div>
                    <dt className="text-muted-foreground">Horario</dt>
                    <dd className="font-medium">
                      {row.startTime} - {row.endTime}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Turno del día</dt>
                  <dd>
                    {row.weekendOrHoliday
                      ? 'Fin de semana o feriado (no se descuenta)'
                      : (row.shiftLabel ?? 'Sin turno / descanso')}
                  </dd>
                </div>
                {row.totalHours != null && (
                  <div>
                    <dt className="text-muted-foreground">Total trabajado</dt>
                    <dd className="font-medium">{formatHours(row.totalHours)}</dd>
                  </div>
                )}
                {row.regularHours != null && (
                  <div>
                    <dt className="text-muted-foreground">Turno normal</dt>
                    <dd>{formatHours(row.regularHours)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Hora extra</dt>
                  <dd className="font-semibold text-primary">
                    {row.hours != null ? formatHours(row.hours) : '—'}
                  </dd>
                </div>
              </>
            )}
            <div className="col-span-2">
              <dt className="text-muted-foreground">Detalle</dt>
              <dd>{row.description}</dd>
            </div>
            {row.projectName && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Proyecto</dt>
                <dd>
                  {row.projectName}
                  {row.clientName ? ` · ${row.clientName}` : ''}
                </dd>
              </div>
            )}
          </dl>

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline">Cerrar</Button>
            </ModalClose>
            {canApprove && row.status === 'PENDIENTE' && !row.isDraft && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/5"
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                >
                  <Ban className="size-4" aria-hidden /> Rechazar
                </Button>
                <Button type="button" onClick={() => void handleApprove()} loading={busy}>
                  <Check className="size-4" aria-hidden /> Aprobar
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Rechazar ${isReimb ? 'reembolso' : 'horas extra'}`}
        reasonRequired={false}
        onConfirm={async (reason) => {
          await onReject(row, reason);
          setRejecting(false);
          onClose();
        }}
      />
    </>
  );
}
