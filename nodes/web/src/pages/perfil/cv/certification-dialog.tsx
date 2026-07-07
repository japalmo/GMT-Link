import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, FileCheck2, TriangleAlert } from 'lucide-react';
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
import { toDateInputValue } from '@/lib/format';
import type {
  CvCertificationInput,
  CvCertificationView,
} from '@/types/cv';
import { FileField, PDF_ACCEPT } from '../file-field';

interface FormState {
  name: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
}

function initialState(cert: CvCertificationView | null): FormState {
  return {
    name: cert?.name ?? '',
    issuer: cert?.issuer ?? '',
    issuedAt: toDateInputValue(cert?.issuedAt ?? null),
    expiresAt: toDateInputValue(cert?.expiresAt ?? null),
  };
}

/**
 * Modal para crear o editar una certificación del CV, con subida opcional del
 * diploma en PDF. Al guardar: persiste la certificación y, si se eligió un
 * archivo, lo sube vía `onUploadDiploma(id, file)` usando el id de la cert
 * guardada (también funciona al crear). Muestra el diploma actual si existe.
 */
export function CertificationDialog({
  open,
  onOpenChange,
  certification,
  onSubmit,
  onUploadDiploma,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certification: CvCertificationView | null;
  onSubmit: (input: CvCertificationInput) => Promise<CvCertificationView>;
  onUploadDiploma: (id: string, file: File) => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(() => initialState(certification));
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Id de la certificación ya creada EN ESTE ciclo de apertura. Evita que un
  // reintento (tras fallar la subida del diploma) vuelva a crear la fila y
  // genere un duplicado: si ya existe, solo se reintenta el diploma.
  const [createdCertId, setCreatedCertId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialState(certification));
      setFile(null);
      setFileError(null);
      setError(null);
      setCreatedCertId(null);
    }
  }, [open, certification]);

  function update<K extends keyof FormState>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.name.trim().length === 0) {
      return setError('El nombre de la certificación es obligatorio.');
    }
    if (form.issuedAt && form.expiresAt && form.expiresAt < form.issuedAt) {
      return setError('La fecha de vencimiento no puede ser anterior a la emisión.');
    }
    if (fileError) return setError(fileError);

    setSubmitting(true);
    setError(null);
    try {
      // En modo crear, si una corrida previa ya persistió la cert (y solo falló
      // la subida del diploma), reutilizamos ese id en vez de crear otra fila.
      const editingId = certification?.id ?? createdCertId;
      let certId: string;
      if (editingId !== null && editingId !== undefined) {
        certId = editingId;
        // Mantén la cert al día si el usuario editó campos antes de reintentar.
        await onSubmit({
          name: form.name.trim(),
          issuer: form.issuer.trim() || undefined,
          issuedAt: form.issuedAt || undefined,
          expiresAt: form.expiresAt || undefined,
        });
      } else {
        const saved = await onSubmit({
          name: form.name.trim(),
          issuer: form.issuer.trim() || undefined,
          issuedAt: form.issuedAt || undefined,
          expiresAt: form.expiresAt || undefined,
        });
        certId = saved.id;
        setCreatedCertId(saved.id);
      }
      if (file) await onUploadDiploma(certId, file);
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar la certificación.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {certification ? 'Editar certificación' : 'Agregar certificación'}
          </ModalTitle>
          <ModalDescription>
            Nombre y emisor. Puedes adjuntar el diploma en PDF.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cert-name">Nombre</Label>
            <Input
              id="cert-name"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cert-issuer">Emisor</Label>
            <Input
              id="cert-issuer"
              value={form.issuer}
              onChange={(e) => update('issuer', e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Opcional.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cert-issued">Fecha de emisión</Label>
              <Input
                id="cert-issued"
                type="date"
                value={form.issuedAt}
                onChange={(e) => update('issuedAt', e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cert-expires">Fecha de vencimiento</Label>
              <Input
                id="cert-expires"
                type="date"
                value={form.expiresAt}
                onChange={(e) => update('expiresAt', e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {certification?.fileUrl && !file && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileCheck2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
              Diploma actual:
              <a
                href={certification.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                ver PDF
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </p>
          )}

          <FileField
            label={certification?.fileUrl ? 'Reemplazar diploma (PDF)' : 'Diploma (PDF)'}
            accept={PDF_ACCEPT}
            value={file}
            disabled={submitting}
            hint="Opcional. Solo PDF, hasta 10 MB."
            onChange={(next, err) => {
              setFile(next);
              setFileError(err);
            }}
          />

          {error && (
            <Alert variant="destructive" live icon={TriangleAlert}>
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
              {certification ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
