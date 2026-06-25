import { useCallback, useState, type ReactNode } from 'react';
import { Check, Copy, KeyRound, TriangleAlert } from 'lucide-react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Una credencial provisoria a mostrar (email + clave generada). */
export interface ProvisionalCredential {
  email: string;
  provisionalPassword: string;
}

/** Botón "copiar" con feedback efímero; usa la Clipboard API con fallback silencioso. */
function CopyButton({ value, label }: { value: string; label: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard no disponible (http, permisos): no rompemos la UI.
      setCopied(false);
    }
  }, [value]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void copy()}
      aria-label={label}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}

/**
 * Diálogo que muestra las claves provisorias recién generadas (§1.1, decisión §9
 * "sin email": el admin las copia y comparte). Se muestran UNA sola vez; el aviso
 * lo deja explícito. Sirve para creación individual y para el lote de importación.
 */
export function CredentialDialog({
  open,
  onOpenChange,
  credentials,
  title = 'Credenciales provisorias',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: readonly ProvisionalCredential[];
  title?: string;
}): ReactNode {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>
            Comparte estas credenciales con cada persona. La clave se cambia en el
            primer ingreso.
          </ModalDescription>
        </ModalHeader>

        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Estas claves no se volverán a mostrar. Cópialas ahora; no quedan
            almacenadas en texto plano.
          </span>
        </div>

        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {credentials.map((cred) => (
            <li
              key={cred.email}
              className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{cred.email}</p>
                <p className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
                  <KeyRound className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{cred.provisionalPassword}</span>
                </p>
              </div>
              <CopyButton
                value={cred.provisionalPassword}
                label={`Copiar la clave de ${cred.email}`}
              />
            </li>
          ))}
        </ul>

        <ModalFooter className={cn('sm:justify-end')}>
          <Button onClick={() => onOpenChange(false)}>Entendido</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
