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
import { formatCLP, formatDate } from '@/lib/format';
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
            <div>
              <dt className="text-muted-foreground">{isReimb ? 'Monto' : 'Horas'}</dt>
              <dd className="font-medium">
                {isReimb
                  ? formatCLP(row.amount ?? 0)
                  : row.hours != null
                    ? `${row.hours} hrs`
                    : 'Borrador'}
              </dd>
            </div>
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
