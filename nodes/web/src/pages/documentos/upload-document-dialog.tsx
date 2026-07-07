import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { errorToMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { UploadDocumentFields } from '@/types/documents';
import { DOC_ACCEPT, FileField } from '../perfil/file-field';

/** Sugerencias de tipo de documento (texto libre; el backend acepta cualquiera). */
const TYPE_SUGGESTIONS = [
  'Carnet de identidad',
  'Contrato',
  'Examen preocupacional',
  'Licencia de conducir',
  'Certificado',
  'Otro',
];

interface FormState {
  type: string;
  name: string;
  issuedAt: string;
  expiresAt: string;
}

const EMPTY: FormState = { type: '', name: '', issuedAt: '', expiresAt: '' };

/**
 * Modal para subir un documento personal nuevo (§6-1.5). Pide archivo
 * (PDF/imagen, validado en cliente), tipo, nombre y fechas opcionales. Tras
 * subir, el backend deja el documento en EN_REVISION. Persiste vía `onSubmit`.
 */
export function UploadDocumentDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (fields: UploadDocumentFields, file: File) => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setFile(null);
      setFileError(null);
      setError(null);
    }
  }, [open]);

  function update<K extends keyof FormState>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!file) return setError('Debes adjuntar un archivo.');
    if (fileError) return setError(fileError);
    if (form.type.trim().length === 0) return setError('El tipo es obligatorio.');
    if (form.name.trim().length === 0) return setError('El nombre es obligatorio.');
    if (form.issuedAt && form.expiresAt && form.expiresAt < form.issuedAt) {
      return setError('La fecha de vencimiento no puede ser anterior a la emisión.');
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(
        {
          type: form.type.trim(),
          name: form.name.trim(),
          issuedAt: form.issuedAt || undefined,
          expiresAt: form.expiresAt || undefined,
        },
        file,
      );
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo subir el documento.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Subir documento</ModalTitle>
          <ModalDescription>
            Adjunta el archivo y completa sus datos. Quedará en revisión.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <FileField
            label="Archivo"
            accept={DOC_ACCEPT}
            value={file}
            disabled={submitting}
            hint="PDF o imagen (PNG, JPG, WebP), hasta 10 MB."
            onChange={(next, err) => {
              setFile(next);
              setFileError(err);
            }}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-type">Tipo de documento</Label>
            <Input
              id="doc-type"
              list="doc-type-options"
              value={form.type}
              onChange={(e) => update('type', e.target.value)}
              placeholder="Ej. Carnet de identidad"
              required
              disabled={submitting}
            />
            <datalist id="doc-type-options">
              {TYPE_SUGGESTIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-name">Nombre</Label>
            <Input
              id="doc-name"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Ej. Cédula vigente 2026"
              required
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-issued">Fecha de emisión</Label>
              <Input
                id="doc-issued"
                type="date"
                value={form.issuedAt}
                onChange={(e) => update('issuedAt', e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-expires">Fecha de vencimiento</Label>
              <Input
                id="doc-expires"
                type="date"
                value={form.expiresAt}
                onChange={(e) => update('expiresAt', e.target.value)}
                disabled={submitting}
              />
            </div>
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
            <Button type="submit" loading={submitting}>
              Subir documento
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
