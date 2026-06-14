import { useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
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

/** Mensaje legible a partir de un error desconocido. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/**
 * Diálogo de confirmación genérico para acciones destructivas (eliminar). Corre
 * `onConfirm` (async), muestra estado de carga y error inline, y cierra al
 * completar con éxito. Controlado vía `open` / `onOpenChange`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Eliminar',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(toMessage(err, 'No se pudo completar la acción.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>

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
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
