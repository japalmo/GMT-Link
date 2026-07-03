import { useState, type ReactNode } from 'react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/** Diálogo mínimo para nombrar un rol personalizado nuevo (sin permisos: se editan después en el editor). */
export function NewRoleDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (label: string) => Promise<void>;
}): ReactNode {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    if (label.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(label.trim());
      setLabel('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el rol.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="sm:max-w-sm">
        <ModalHeader>
          <ModalTitle>Nuevo rol</ModalTitle>
          <ModalDescription>Elige un nombre; los permisos se configuran después.</ModalDescription>
        </ModalHeader>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium leading-none">Nombre</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <ModalFooter>
          <Button type="button" onClick={() => void handleCreate()} disabled={busy || label.trim().length === 0}>
            Crear
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
