import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type {
  CreateServiceTypeInput,
  Procedimiento,
  ServiceTypeView,
  UpdateServiceTypeInput,
} from '@gmt-platform/contracts';
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
import { Textarea } from '@/components/ui/textarea';
import { createServiceType, errorToMessage, updateServiceType } from '@/lib/api';
import { toast } from 'sonner';

const CODE_RE = /^[A-Za-z0-9]{2,4}$/;

interface FormState {
  code: string;
  name: string;
  description: string;
  requiresClientSignature: boolean;
  isActive: boolean;
  procedures: Procedimiento[];
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  description: '',
  requiresClientSignature: false,
  isActive: true,
  procedures: [],
};

function seed(type: ServiceTypeView | null): FormState {
  if (!type) return EMPTY_FORM;
  return {
    code: type.code,
    name: type.name,
    description: type.description ?? '',
    requiresClientSignature: type.requiresClientSignature,
    isActive: type.isActive,
    procedures: type.procedures.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      instrucciones: p.instrucciones ?? '',
    })),
  };
}

/** Id estable para un procedimiento nuevo. */
function newProcedureId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Diálogo de crear/editar un tipo de servicio (catálogo org, Tanda 4). Campos:
 * código corto (semilla del §7), nombre, descripción, si requiere firma de cliente,
 * activo (solo edición) y el editor de PROCEDIMIENTOS (pasos con instrucciones,
 * agregar/quitar). Al guardar llama a `POST`/`PATCH /service-types`. Abierto con
 * `open`; `initial=null` = crear.
 */
export function ServiceTypeDialog({
  open,
  initial,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  initial: ServiceTypeView | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: ServiceTypeView) => void;
}): ReactNode {
  const baseId = useId();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = initial !== null;
  const openKey = open ? (initial?.id ?? 'new') : null;

  // Re-siembra síncrona al abrir (crear o editar otro tipo), sin frame con datos viejos.
  if (openKey !== null && openKey !== seededKey) {
    setForm(seed(initial));
    setSeededKey(openKey);
    setError(null);
  }
  if (openKey === null && seededKey !== null) {
    setSeededKey(null);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateProcedure(id: string, patch: Partial<Procedimiento>): void {
    setForm((prev) => ({
      ...prev,
      procedures: prev.procedures.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }

  function addProcedure(): void {
    setForm((prev) => ({
      ...prev,
      procedures: [...prev.procedures, { id: newProcedureId(), nombre: '', instrucciones: '' }],
    }));
  }

  function removeProcedure(id: string): void {
    setForm((prev) => ({ ...prev, procedures: prev.procedures.filter((p) => p.id !== id) }));
  }

  function validate(): string | null {
    if (!CODE_RE.test(form.code.trim())) {
      return 'El código debe tener 2 a 4 caracteres alfanuméricos.';
    }
    if (form.name.trim().length === 0) return 'El nombre es obligatorio.';
    if (form.procedures.some((p) => p.nombre.trim().length === 0)) {
      return 'Cada procedimiento necesita un nombre (o quítalo).';
    }
    return null;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    // Limpia los procedimientos: recorta y descarta instrucciones vacías.
    const procedures: Procedimiento[] = form.procedures.map((p) => ({
      id: p.id,
      nombre: p.nombre.trim(),
      instrucciones: (p.instrucciones ?? '').trim() || null,
    }));
    try {
      let saved: ServiceTypeView;
      if (isEdit && initial) {
        const input: UpdateServiceTypeInput = {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          description: form.description.trim() || null,
          requiresClientSignature: form.requiresClientSignature,
          isActive: form.isActive,
          procedures,
        };
        saved = await updateServiceType(initial.id, input);
      } else {
        const input: CreateServiceTypeInput = {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          description: form.description.trim() || null,
          requiresClientSignature: form.requiresClientSignature,
          procedures,
        };
        saved = await createServiceType(input);
      }
      toast.success(isEdit ? 'Tipo de servicio actualizado.' : 'Tipo de servicio creado.');
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar el tipo de servicio.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // No permitir cerrar (Cancelar / X / ESC / overlay) mientras se guarda.
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <ModalContent className="sm:max-w-2xl">
        <ModalHeader>
          <ModalTitle>{isEdit ? 'Editar tipo de servicio' : 'Nuevo tipo de servicio'}</ModalTitle>
          <ModalDescription>
            El código es la semilla del código de documento. Los procedimientos son los pasos con
            instrucciones del servicio.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-code`}>Código</Label>
              <Input
                id={`${baseId}-code`}
                value={form.code}
                onChange={(e) => update('code', e.target.value.toUpperCase())}
                maxLength={4}
                placeholder="TOP"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${baseId}-name`}>Nombre</Label>
              <Input
                id={`${baseId}-name`}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Ej. Topografía"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-desc`}>Descripción</Label>
            <Textarea
              id={`${baseId}-desc`}
              rows={2}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Descripción del tipo de servicio (opcional)."
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={form.requiresClientSignature}
              onChange={(e) => update('requiresClientSignature', e.target.checked)}
            />
            Los documentos de este tipo requieren firma de cliente
          </label>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={form.isActive}
                onChange={(e) => update('isActive', e.target.checked)}
              />
              Activo (disponible al crear servicios)
            </label>
          )}

          {/* Editor de procedimientos. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Procedimientos</Label>
              <Button type="button" variant="outline" size="sm" onClick={addProcedure}>
                <Plus aria-hidden />
                Agregar procedimiento
              </Button>
            </div>
            {form.procedures.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin procedimientos. Agrega los pasos de trabajo de este tipo de servicio.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {form.procedures.map((p, index) => (
                  <li key={p.id} className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 text-xs font-medium text-muted-foreground">{index + 1}.</span>
                      <div className="flex flex-1 flex-col gap-2">
                        <Input
                          aria-label={`Nombre del procedimiento ${index + 1}`}
                          value={p.nombre}
                          onChange={(e) => updateProcedure(p.id, { nombre: e.target.value })}
                          placeholder="Nombre del procedimiento"
                        />
                        <Textarea
                          aria-label={`Instrucciones del procedimiento ${index + 1}`}
                          rows={2}
                          value={p.instrucciones ?? ''}
                          onChange={(e) => updateProcedure(p.id, { instrucciones: e.target.value })}
                          placeholder="Instrucciones (opcional)."
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeProcedure(p.id)}
                        aria-label={`Quitar procedimiento ${index + 1}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {isEdit ? 'Guardar cambios' : 'Crear tipo'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
