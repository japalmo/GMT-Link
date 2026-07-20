import { useState, type ReactNode } from 'react';
import { Ban, Check, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { RejectDialog } from '@/components/ui/reject-dialog';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
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
  /**
   * Borra la solicitud (por si se equivocan o duplican). La visibilidad la decide el
   * caller pasando (o no) el handler: el DUEÑO puede borrar la suya y quien gestiona
   * finanzas cualquiera, siempre en cualquier estado salvo PAGADO. Si se omite, no se
   * muestra el botón.
   */
  onDelete?: (row: FinanceRow) => Promise<void>;
  /**
   * Edita la solicitud. Solo lo pasa el DUEÑO desde "Mis solicitudes"; abre el
   * formulario de edición. El botón aparece solo si la solicitud está PENDIENTE y no
   * es borrador. Si se omite, no se muestra "Editar".
   */
  onEdit?: (row: FinanceRow) => void;
  /**
   * `true` cuando la solicitud la abre su propio DUEÑO ("Mis solicitudes"): el título
   * y la confirmación de borrado omiten el nombre del solicitante (es el usuario
   * actual, y las listas propias no traen `requester`, así que quedaría "—").
   */
  mine?: boolean;
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
  onDelete,
  onEdit,
  mine = false,
}: RequestDetailDialogProps): ReactNode {
  const [rejecting, setRejecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      <Modal open={row !== null && !rejecting && !deleting} onOpenChange={(o) => { if (!o) onClose(); }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {isReimb ? 'Reembolso' : 'Horas extra'}
              {mine ? '' : `: ${row.requesterName}`}
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
            {/* Editar: solo el DUEÑO (el caller pasa onEdit), y solo si sigue
                PENDIENTE y no es borrador. Abre el formulario de edición. */}
            {onEdit && row.status === 'PENDIENTE' && !row.isDraft && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onEdit(row)}
                disabled={busy}
              >
                <Pencil className="size-4" aria-hidden /> Editar
              </Button>
            )}
            {/* Borrar: la visibilidad la controla el caller (dueño o gestión), en
                cualquier estado salvo pagada. */}
            {onDelete && row.status !== 'PAGADO' && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:bg-destructive/5"
                onClick={() => setDeleting(true)}
                disabled={busy}
              >
                <Trash2 className="size-4" aria-hidden /> Borrar
              </Button>
            )}
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

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Borrar ${isReimb ? 'reembolso' : 'horas extra'}`}
        description={
          mine
            ? 'Se eliminará esta solicitud de forma permanente. Esta acción no se puede deshacer.'
            : `Se eliminará de forma permanente la solicitud de ${row.requesterName}. Esta acción no se puede deshacer.`
        }
        confirmLabel="Borrar"
        onConfirm={async () => {
          if (onDelete) await onDelete(row);
          setDeleting(false);
          onClose();
        }}
      />
    </>
  );
}
