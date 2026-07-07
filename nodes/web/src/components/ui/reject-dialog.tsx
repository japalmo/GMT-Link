import { useEffect, useId, useState, type ReactNode } from 'react';
import { errorToMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';

export interface RejectDialogProps {
  /** Si el modal está abierto. */
  open: boolean;
  /** Cambia el estado abierto/cerrado (se ignora mientras se envía). */
  onOpenChange: (open: boolean) => void;
  /** Título del modal (p. ej. "Rechazar reembolso"). */
  title: string;
  /** Descripción opcional bajo el título. */
  description?: ReactNode;
  /**
   * Confirma el rechazo con el motivo (ya `trim()`-eado). Debe lanzar para que
   * el modal muestre el error y NO se cierre; al resolver, el modal se cierra.
   */
  onConfirm: (reason: string) => Promise<void>;
  /** Etiqueta del botón de confirmación (default: "Rechazar"). */
  confirmLabel?: string;
  /**
   * Si es `true`, exige un motivo no vacío antes de confirmar (deshabilita el
   * botón y muestra error si se intenta). Si es `false`, el motivo es opcional.
   * Default: `true`.
   */
  reasonRequired?: boolean;
  /** Largo máximo del motivo (default: 1000). */
  reasonMaxLength?: number;
}

/**
 * Diálogo de rechazo genérico del design system. Reúne los dos `reject-dialog`
 * por-dominio (finanzas / recursos): Modal + Textarea DS + `<Alert
 * variant="destructive">` para el error, con manejo de envío y normalización de
 * errores vía `errorToMessage`. Reinicia motivo y error cada vez que se abre.
 */
export function RejectDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = 'Rechazar',
  reasonRequired = true,
  reasonMaxLength = 1000,
}: RejectDialogProps): ReactNode {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  async function handleConfirm(): Promise<void> {
    const trimmed = reason.trim();
    if (reasonRequired && trimmed.length === 0) {
      setError('Debe ingresar un motivo para el rechazo.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo completar el rechazo.'));
    } finally {
      setSubmitting(false);
    }
  }

  const disableConfirm = submitting || (reasonRequired && reason.trim().length === 0);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          {description && <ModalDescription>{description}</ModalDescription>}
        </ModalHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={reasonId}>
            {reasonRequired ? 'Motivo del rechazo' : 'Motivo (opcional)'}
          </Label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            rows={4}
            maxLength={reasonMaxLength}
            disabled={submitting}
            placeholder="Explica por qué se rechaza (lo verá quien solicitó)."
          />
        </div>

        {error && (
          <Alert variant="destructive" live>
            {error}
          </Alert>
        )}

        <ModalFooter>
          <ModalClose asChild>
            <Button type="button" variant="outline" disabled={submitting}>
              Cancelar
            </Button>
          </ModalClose>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            loading={submitting}
            disabled={disableConfirm}
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
