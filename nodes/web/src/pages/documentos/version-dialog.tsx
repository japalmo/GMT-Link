import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { errorToMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
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
import type { PersonalDocumentView } from '@/types/documents';
import { DOC_ACCEPT, FileField } from '../perfil/file-field';

/**
 * Modal para subir una versión nueva de un documento existente (§6-1.5). Tras
 * subir, el backend conserva la versión anterior (`previousFileUrl`) y vuelve el
 * documento a EN_REVISION. Solo pide el archivo (PDF/imagen, validado en cliente).
 */
export function VersionDialog({
  document,
  onOpenChange,
  onSubmit,
}: {
  /** Documento a versionar; `null` mantiene el modal cerrado. */
  document: PersonalDocumentView | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (id: string, file: File) => Promise<void>;
}): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = document !== null;

  useEffect(() => {
    if (open) {
      setFile(null);
      setFileError(null);
      setError(null);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!document) return;
    if (!file) return setError('Debes adjuntar un archivo.');
    if (fileError) return setError(fileError);

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(document.id, file);
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo subir la versión.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Subir nueva versión</ModalTitle>
          <ModalDescription>
            {document ? `Reemplaza el archivo de "${document.name}".` : ''}
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Alert>
            La versión anterior se conservará y el documento volverá a quedar en
            revisión.
          </Alert>

          <FileField
            label="Archivo nuevo"
            accept={DOC_ACCEPT}
            value={file}
            disabled={submitting}
            hint="PDF o imagen (PNG, JPG, WebP), hasta 10 MB."
            onChange={(next, err) => {
              setFile(next);
              setFileError(err);
            }}
          />

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
            <Button type="submit" loading={submitting}>
              Subir versión
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
