import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { errorToMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import type { ServiceView } from '@/types/operations';
import { PDF_ACCEPT, FileField } from '../perfil/file-field';

/** Campos de metadatos que exige el backend para subir un documento de proyecto. */
export interface UploadProjectDocumentFields {
  name: string;
  serviceId: string;
  documentType: string;
  areaCode: string;
}

interface FormState {
  name: string;
  serviceId: string;
  documentType: string;
  areaCode: string;
}

const EMPTY: FormState = { name: '', serviceId: '', documentType: '', areaCode: '' };

/**
 * Modal para subir un documento de proyecto nuevo (§7 — codificación de
 * documentos). El backend exige archivo **PDF**, nombre, servicio, código de
 * tipo de documento (2–4 chars) y código de área (2–4 chars). Persiste vía
 * `onSubmit`; el diálogo maneja sus propios estados de validación/carga/error.
 */
export function UploadProjectDocumentDialog({
  open,
  onOpenChange,
  services,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceView[];
  onSubmit: (fields: UploadProjectDocumentFields, file: File) => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Servicio por defecto: el primero disponible al abrir.
  const defaultServiceId = useMemo(() => services[0]?.id ?? '', [services]);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, serviceId: defaultServiceId });
      setFile(null);
      setFileError(null);
      setError(null);
    }
  }, [open, defaultServiceId]);

  function update<K extends keyof FormState>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!file) return setError('Debes adjuntar un archivo PDF.');
    if (fileError) return setError(fileError);
    if (form.name.trim().length === 0) return setError('El nombre es obligatorio.');
    if (form.serviceId.length === 0) return setError('Debes seleccionar un servicio.');
    const documentType = form.documentType.trim().toUpperCase();
    const areaCode = form.areaCode.trim().toUpperCase();
    if (documentType.length < 2 || documentType.length > 4) {
      return setError('El código de tipo de documento debe tener entre 2 y 4 caracteres.');
    }
    if (areaCode.length < 2 || areaCode.length > 4) {
      return setError('El código de área debe tener entre 2 y 4 caracteres.');
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(
        {
          name: form.name.trim(),
          serviceId: form.serviceId,
          documentType,
          areaCode,
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
            Adjunta el PDF y completa su codificación. Quedará en borrador.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <FileField
            label="Archivo"
            accept={PDF_ACCEPT}
            value={file}
            disabled={submitting}
            hint="Solo PDF, hasta 25 MB."
            onChange={(next, err) => {
              setFile(next);
              setFileError(err);
            }}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pdoc-name">Nombre</Label>
            <Input
              id="pdoc-name"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Ej. Bases técnicas rev. A"
              required
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pdoc-service">Servicio</Label>
            <Select
              id="pdoc-service"
              aria-label="Servicio"
              value={form.serviceId}
              onChange={(e) => update('serviceId', e.target.value)}
              required
              disabled={submitting || services.length === 0}
            >
              {services.length === 0 && <option value="">Sin servicios disponibles</option>}
              {services.map((srv) => (
                <option key={srv.id} value={srv.id}>
                  {srv.code}: {srv.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pdoc-type">Tipo de documento</Label>
              <Input
                id="pdoc-type"
                value={form.documentType}
                onChange={(e) => update('documentType', e.target.value)}
                placeholder="Ej. BT"
                maxLength={4}
                required
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">Código de 2 a 4 caracteres.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pdoc-area">Área</Label>
              <Input
                id="pdoc-area"
                value={form.areaCode}
                onChange={(e) => update('areaCode', e.target.value)}
                placeholder="Ej. TOP"
                maxLength={4}
                required
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">Código de 2 a 4 caracteres.</p>
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
            <Button type="submit" loading={submitting} disabled={services.length === 0}>
              Subir documento
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
