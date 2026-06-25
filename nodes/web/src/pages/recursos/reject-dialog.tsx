import { useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export function RejectDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Rechazar',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    if (!reason.trim()) {
      setError('Debe ingresar un motivo para el rechazo.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onOpenChange(false);
    } catch (err) {
      setError(toMessage(err, 'No se pudo completar el rechazo.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        if (!next) {
          setError(null);
          setReason('');
        }
        onOpenChange(next);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-2 my-2">
          <Label htmlFor="reject-reason">Motivo del rechazo</Label>
          <Textarea
            id="reject-reason"
            placeholder="Escriba aquí el motivo..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            disabled={submitting}
            rows={4}
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
            <Button variant="outline" disabled={submitting}>
              Cancelar
            </Button>
          </ModalClose>
          <Button
            variant="destructive"
            loading={submitting}
            onClick={() => void handleConfirm()}
            disabled={!reason.trim()}
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
