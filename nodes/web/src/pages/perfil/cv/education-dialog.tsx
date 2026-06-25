import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
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
import type { CvEducationInput, CvEducationView } from '@/types/cv';

/** Mensaje legible a partir de un error desconocido. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

interface FormState {
  institution: string;
  degree: string;
  startDate: string;
  endDate: string;
}

function initialState(education: CvEducationView | null): FormState {
  return {
    institution: education?.institution ?? '',
    degree: education?.degree ?? '',
    startDate: toDateInputValue(education?.startDate ?? null),
    endDate: toDateInputValue(education?.endDate ?? null),
  };
}

/**
 * Modal para crear o editar una formación académica del CV. Valida institución
 * y título; las fechas son opcionales. Persiste vía `onSubmit`.
 */
export function EducationDialog({
  open,
  onOpenChange,
  education,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  education: CvEducationView | null;
  onSubmit: (input: CvEducationInput) => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(() => initialState(education));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialState(education));
      setError(null);
    }
  }, [open, education]);

  function update<K extends keyof FormState>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.institution.trim().length === 0) {
      return setError('La institución es obligatoria.');
    }
    if (form.degree.trim().length === 0) {
      return setError('El título es obligatorio.');
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      return setError('La fecha de término no puede ser anterior al inicio.');
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        institution: form.institution.trim(),
        degree: form.degree.trim(),
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(toMessage(err, 'No se pudo guardar la formación.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{education ? 'Editar formación' : 'Agregar formación'}</ModalTitle>
          <ModalDescription>
            Institución, título y periodo (las fechas son opcionales).
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edu-institution">Institución</Label>
            <Input
              id="edu-institution"
              value={form.institution}
              onChange={(e) => update('institution', e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edu-degree">Título o grado</Label>
            <Input
              id="edu-degree"
              value={form.degree}
              onChange={(e) => update('degree', e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edu-start">Fecha de inicio</Label>
              <Input
                id="edu-start"
                type="date"
                value={form.startDate}
                onChange={(e) => update('startDate', e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edu-end">Fecha de término</Label>
              <Input
                id="edu-end"
                type="date"
                value={form.endDate}
                onChange={(e) => update('endDate', e.target.value)}
                disabled={submitting}
              />
            </div>
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
              <Button type="button" variant="outline" disabled={submitting}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={submitting}>
              {education ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
