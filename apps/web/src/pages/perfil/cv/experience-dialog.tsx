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
import type { CvExperienceInput, CvExperienceView } from '@/types/cv';

/** Mensaje legible a partir de un error desconocido. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

interface FormState {
  role: string;
  company: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

function initialState(experience: CvExperienceView | null): FormState {
  return {
    role: experience?.role ?? '',
    company: experience?.company ?? '',
    startDate: toDateInputValue(experience?.startDate ?? null),
    endDate: toDateInputValue(experience?.endDate ?? null),
    current: experience ? experience.endDate === null : true,
    description: experience?.description ?? '',
  };
}

/**
 * Modal para crear o editar una experiencia laboral del CV. Si recibe
 * `experience`, edita; si es `null`, crea. Valida cargo, empresa y fecha de
 * inicio. "Trabajo actual" envía `endDate` sin fijar. Persiste vía `onSubmit`.
 */
export function ExperienceDialog({
  open,
  onOpenChange,
  experience,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  experience: CvExperienceView | null;
  onSubmit: (input: CvExperienceInput) => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(() => initialState(experience));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sincroniza el formulario cada vez que se (re)abre con un item distinto.
  useEffect(() => {
    if (open) {
      setForm(initialState(experience));
      setError(null);
    }
  }, [open, experience]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.role.trim().length === 0) return setError('El cargo es obligatorio.');
    if (form.company.trim().length === 0) {
      return setError('La empresa es obligatoria.');
    }
    if (form.startDate.length === 0) {
      return setError('La fecha de inicio es obligatoria.');
    }
    if (!form.current && form.endDate && form.endDate < form.startDate) {
      return setError('La fecha de término no puede ser anterior al inicio.');
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        role: form.role.trim(),
        company: form.company.trim(),
        startDate: form.startDate,
        endDate: form.current ? undefined : form.endDate || undefined,
        description: form.description.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(toMessage(err, 'No se pudo guardar la experiencia.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{experience ? 'Editar experiencia' : 'Agregar experiencia'}</ModalTitle>
          <ModalDescription>
            Cargo, empresa y periodo. La descripción es opcional.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-role">Cargo</Label>
            <Input
              id="exp-role"
              value={form.role}
              onChange={(e) => update('role', e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-company">Empresa</Label>
            <Input
              id="exp-company"
              value={form.company}
              onChange={(e) => update('company', e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-start">Fecha de inicio</Label>
              <Input
                id="exp-start"
                type="date"
                value={form.startDate}
                onChange={(e) => update('startDate', e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-end">Fecha de término</Label>
              <Input
                id="exp-end"
                type="date"
                value={form.endDate}
                onChange={(e) => update('endDate', e.target.value)}
                disabled={submitting || form.current}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
              checked={form.current}
              onChange={(e) => update('current', e.target.checked)}
              disabled={submitting}
            />
            Trabajo aquí actualmente
          </label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-description">Descripción</Label>
            <textarea
              id="exp-description"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              disabled={submitting}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">Opcional.</p>
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
              {experience ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
