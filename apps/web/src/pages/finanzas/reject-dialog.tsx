import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { ApiError } from '@/lib/api';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

interface RejectDialogProps {
  /** Si el modal está abierto. */
  open: boolean;
  /** Cambia el estado abierto/cerrado (se ignora mientras se envía). */
  onOpenChange: (open: boolean) => void;
  /** Título del modal (p. ej. "Rechazar reembolso"). */
  title: string;
  /**
   * Confirma el rechazo con el motivo (puede ir vacío). Debe lanzar para que el
   * modal muestre el error y NO se cierre; al resolver, el modal se cierra.
   */
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Modal genérico de rechazo para finanzas (reembolsos / horas extra). Pide un
 * "Motivo (opcional)" en un textarea (máx. 1000) y llama a `onConfirm(reason)`.
 * Gestiona el estado de envío y los errores de la API (mismo patrón que el modal
 * de rechazo de solicitudes en `pending-requests-section.tsx`). Reinicia el
 * motivo y el error cada vez que se abre.
 */
export function RejectDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
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

  const confirm = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch (err) {
      setError(toMessage(err, 'No se pudo rechazar la solicitud.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={reasonId}>Motivo (opcional)</Label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            disabled={submitting}
            placeholder="Explica por qué se rechaza (lo verá quien solicitó)."
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <ModalFooter>
          <ModalClose asChild>
            <Button type="button" variant="outline" disabled={submitting}>
              Cancelar
            </Button>
          </ModalClose>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            loading={submitting}
          >
            Rechazar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
