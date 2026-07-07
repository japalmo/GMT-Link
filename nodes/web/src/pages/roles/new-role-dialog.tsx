import { useState, type ReactNode } from 'react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorToMessage } from '@/lib/api';

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
      setError(errorToMessage(err, 'No se pudo crear el rol.'));
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

        <Label className="flex flex-col gap-1.5">
          <span>Nombre</span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
          />
        </Label>

        {error && (
          <Alert variant="destructive" live>
            {error}
          </Alert>
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
