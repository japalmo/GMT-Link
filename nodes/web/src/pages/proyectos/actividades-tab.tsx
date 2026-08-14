import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from '@/components/ui/modal';
import { useTasks } from '@/hooks/use-operations';
import { useUsers } from '@/hooks/use-users';
import { EmptyState } from '@/components/ui/states';
import { ListChecks } from 'lucide-react';
import { errorToMessage } from '@/lib/api';
import type { ServiceView, TaskView } from '@/types/operations';
import type { TaskDataSpec } from '@gmt-platform/contracts';

interface ActividadesTabProps {
  projectId: string;
  services: ServiceView[];
  canCreate: boolean;
}

interface StepForm {
  _key: string;
  name: string;
  assignedToId: string;
  startDate: string;
  reviewDate: string;
  dueDate: string;
  taskProduct: 'time_only' | 'DOCUMENTO' | 'DATO';
}

function newStepRow(): StepForm {
  return {
    _key: crypto.randomUUID(),
    name: '',
    assignedToId: '',
    startDate: '',
    reviewDate: '',
    dueDate: '',
    taskProduct: 'time_only',
  };
}

export function ActividadesTab({ projectId, services, canCreate }: ActividadesTabProps): ReactNode {
  const { tasks, loading, create, update, remove } = useTasks({ projectId });
  const { items: users } = useUsers({ limit: 100 });

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editar / borrar una actividad (raíz). El backend (PUT/DELETE /tasks/:id) ya
  // autoriza; en la UI se muestra a quien puede gestionar el plan (canCreate).
  const [editing, setEditing] = useState<TaskView | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [editReviewDate, setEditReviewDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPoints, setEditPoints] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState<TaskView | null>(null);

  const openEdit = (t: TaskView) => {
    setEditing(t);
    setEditName(t.name);
    setEditDesc(t.description ?? '');
    setEditAssignee(t.assignedToId ?? '');
    setEditReviewDate(t.reviewDate ? t.reviewDate.slice(0, 10) : '');
    setEditDueDate(t.dueDate ? t.dueDate.slice(0, 10) : '');
    setEditPoints(t.estimatedPoints ?? 0);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!editName.trim()) {
      toast.error('Ingresa el nombre de la actividad.');
      return;
    }
    setSavingEdit(true);
    try {
      await update(editing.id, {
        name: editName.trim(),
        description: editDesc.trim() || null,
        assignedToId: editAssignee || null,
        reviewDate: editReviewDate || null,
        dueDate: editDueDate || null,
        estimatedPoints: editPoints,
      });
      toast.success('Actividad actualizada.');
      setEditing(null);
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo actualizar la actividad.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      toast.success('Actividad eliminada.');
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo eliminar la actividad.'));
    } finally {
      setDeleting(null);
    }
  };

  // Main Activity
  const [mainName, setMainName] = useState('');
  const [mainDesc, setMainDesc] = useState('');
  const [mainServiceId, setMainServiceId] = useState('');
  const [mainStartDate, setMainStartDate] = useState('');
  const [mainReviewDate, setMainReviewDate] = useState('');
  const [mainDueDate, setMainDueDate] = useState('');

  // Steps
  const [steps, setSteps] = useState<StepForm[]>([newStepRow()]);

  const openCreator = () => {
    setMainName('');
    setMainDesc('');
    setMainServiceId('');
    setMainStartDate('');
    setMainReviewDate('');
    setMainDueDate('');
    setSteps([newStepRow()]);
    setCreatorOpen(true);
  };

  const addStep = () => {
    setSteps((prev) => [...prev, newStepRow()]);
  };

  const removeStep = (key: string) => {
    setSteps((prev) => {
      const next = prev.filter((s) => s._key !== key);
      recalculateMaxDueDate(next);
      return next;
    });
  };

  const recalculateMaxDueDate = (stepList: StepForm[]) => {
    const dates = stepList.map((s) => s.dueDate).filter(Boolean);
    if (dates.length > 0) {
      dates.sort();
      const maxDate = dates[dates.length - 1];
      if (maxDate) {
        setMainDueDate(maxDate);
      }
    }
  };

  const updateStep = (key: string, patch: Partial<StepForm>) => {
    setSteps((prev) => {
      const next = prev.map((s) => (s._key === key ? { ...s, ...patch } : s));
      if ('dueDate' in patch) {
        recalculateMaxDueDate(next);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mainName.trim()) {
      toast.error('Ingresa el nombre de la actividad.');
      return;
    }
    
    // Validate steps
    const mappedSteps = [];
    for (const step of steps) {
      if (!step.name.trim()) {
        toast.error('Todos los pasos deben tener un nombre.');
        return;
      }
      if (!step.assignedToId) {
        toast.error(`Asigna un responsable al paso "${step.name}".`);
        return;
      }
      
      let dataSpec: TaskDataSpec | undefined;
      if (step.taskProduct === 'time_only') {
        dataSpec = { type: 'NINGUNO', label: 'Solo registro de tiempo' };
      } else if (step.taskProduct === 'DOCUMENTO') {
        dataSpec = { type: 'DOCUMENTO', label: 'Informe' };
      } else if (step.taskProduct === 'DATO') {
        dataSpec = {
          type: 'DATO',
          label: 'Ingreso de datos / Mediciones',
          fields: {
            cota_espejo: 'Cota espejo (m)',
            vol_salmuera: 'Volumen salmuera (m³)',
          },
        };
      }

      mappedSteps.push({
        name: step.name,
        assignedToId: step.assignedToId,
        startDate: step.startDate || undefined,
        reviewDate: step.reviewDate || undefined,
        dueDate: step.dueDate || undefined,
        dataSpec,
      });
    }

    setSaving(true);
    try {
      await create({
        name: mainName.trim(),
        description: mainDesc.trim() || undefined,
        projectId,
        serviceId: mainServiceId || undefined,
        type: 'SPOT',
        priorityManual: false,
        startDate: mainStartDate || undefined,
        reviewDate: mainReviewDate || undefined,
        dueDate: mainDueDate || undefined,
        steps: mappedSteps,
      });
      toast.success('Actividad creada exitosamente (cascada).');
      setCreatorOpen(false);
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo crear la actividad.'));
    } finally {
      setSaving(false);
    }
  };

  // Actividades principales (parentId = null) y sus pasos correspondientes
  const rootTasks = tasks.filter((t) => !t.parentId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">Plan de Actividades</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            Genera actividades y diseña su cascada de pasos con fechas independientes.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreator}>
            <Plus className="mr-2 size-4" />
            Crear actividad
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Cargando actividades...
        </div>
      ) : rootTasks.length === 0 ? (
        <div className="border rounded-md p-8 bg-muted/20 flex flex-col items-center justify-center text-center">
          <EmptyState
            icon={ListChecks}
            title="Creador de Actividades"
            message="Utiliza el botón superior para crear una nueva actividad en cascada para este proyecto."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {rootTasks.map((activity) => {
            const childSteps = tasks.filter((t) => t.parentId === activity.id);
            return (
              <div key={activity.id} className="border rounded-lg p-4 bg-card shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base text-foreground">{activity.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded bg-muted font-medium text-muted-foreground">
                        {activity.status}
                      </span>
                      {activity.priority && (
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          activity.priority === 'URGENTE' ? 'bg-red-100 text-red-700' :
                          activity.priority === 'ALTA' ? 'bg-orange-100 text-orange-700' :
                          activity.priority === 'MEDIA' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {activity.priority}
                        </span>
                      )}
                    </div>
                    {activity.description && (
                      <p className="text-sm text-muted-foreground mt-1">{activity.description}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {canCreate && (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => openEdit(activity)}
                          aria-label={`Editar ${activity.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(activity)}
                          aria-label={`Borrar ${activity.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground text-right space-y-1">
                      {activity.startDate && <div>Inicio: {activity.startDate.slice(0, 10)}</div>}
                      {activity.reviewDate && <div>Revisión: {activity.reviewDate.slice(0, 10)}</div>}
                      {activity.dueDate && <div>Entrega: {activity.dueDate.slice(0, 10)}</div>}
                    </div>
                  </div>
                </div>

                {/* Subpasos / Hijos */}
                {childSteps.length > 0 && (
                  <div className="mt-3 pl-4 border-l-2 border-muted space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pasos:</h4>
                    {childSteps.map((step) => (
                      <div key={step.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0 border-muted/50">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{step.name}</span>
                          <span className="text-xs text-muted-foreground">({step.status})</span>
                          {step.assignedTo && (
                            <span className="text-xs text-muted-foreground">
                              Assigned: {step.assignedTo.firstName} {step.assignedTo.lastName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {step.priority && <span className="font-semibold">{step.priority}</span>}
                          {step.dueDate && <span>Vence: {step.dueDate.slice(0, 10)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={creatorOpen} onOpenChange={setCreatorOpen}>
        <ModalContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <ModalHeader>
              <ModalTitle>Crear Actividad en Cascada</ModalTitle>
              <ModalDescription>
                Define la actividad principal y los pasos específicos necesarios para completarla.
              </ModalDescription>
            </ModalHeader>

            {/* Actividad Principal */}
            <div className="flex flex-col gap-4 border p-4 rounded-md bg-muted/10">
              <h3 className="font-medium text-sm text-foreground">1. Actividad Principal</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mainName">Nombre de la actividad</Label>
                  <Input
                    id="mainName"
                    value={mainName}
                    onChange={(e) => setMainName(e.target.value)}
                    placeholder="Ej. Inspección de Bombas"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mainServiceId">Servicio Asociado (Opcional)</Label>
                  <Select
                    id="mainServiceId"
                    aria-label="Servicio Asociado"
                    value={mainServiceId}
                    onChange={(e) => setMainServiceId(e.target.value)}
                  >
                    <option value="">(Ninguno)</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="mainDesc">Descripción general</Label>
                  <Textarea
                    id="mainDesc"
                    value={mainDesc}
                    onChange={(e) => setMainDesc(e.target.value)}
                    rows={2}
                  />
                </div>
                {/* Fechas de la Actividad Principal */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mainStartDate">Fecha de Inicio</Label>
                  <Input
                    id="mainStartDate"
                    type="date"
                    value={mainStartDate}
                    onChange={(e) => setMainStartDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mainReviewDate">Fecha de Revisión</Label>
                  <Input
                    id="mainReviewDate"
                    type="date"
                    value={mainReviewDate}
                    onChange={(e) => setMainReviewDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="mainDueDate">Fecha de Entrega (Auto-calculada según pasos o manual)</Label>
                  <Input
                    id="mainDueDate"
                    type="date"
                    value={mainDueDate}
                    onChange={(e) => setMainDueDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Pasos */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm text-foreground">2. Pasos a ejecutar</h3>
                <Button type="button" variant="outline" size="sm" onClick={addStep}>
                  <Plus className="mr-1 size-4" /> Agregar paso
                </Button>
              </div>

              {steps.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-4 border rounded-md">
                  No has agregado ningún paso.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {steps.map((step, idx) => (
                    <div key={step._key} className="flex flex-col gap-3 p-4 border rounded-md bg-card shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Paso {idx + 1}
                        </span>
                        {steps.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeStep(step._key)}
                            className="size-6 text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-12 md:col-span-6 flex flex-col gap-1.5">
                          <Label className="text-xs">Nombre del paso</Label>
                          <Input
                            value={step.name}
                            onChange={(e) => updateStep(step._key, { name: e.target.value })}
                            placeholder="Ej. Revisar niveles"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-6 flex flex-col gap-1.5">
                          <Label className="text-xs">Responsable</Label>
                          <Select
                            value={step.assignedToId}
                            aria-label="Responsable del paso"
                            onChange={(e) => updateStep(step._key, { assignedToId: e.target.value })}
                            className="h-8 text-sm"
                          >
                            <option value="">Selecciona usuario...</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.firstName} {u.lastName}
                              </option>
                            ))}
                          </Select>
                        </div>

                        {/* Fechas */}
                        <div className="col-span-12 md:col-span-4 flex flex-col gap-1.5">
                          <Label className="text-xs">Inicio</Label>
                          <Input
                            type="date"
                            value={step.startDate}
                            onChange={(e) => updateStep(step._key, { startDate: e.target.value })}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-4 flex flex-col gap-1.5">
                          <Label className="text-xs">Revisión</Label>
                          <Input
                            type="date"
                            value={step.reviewDate}
                            onChange={(e) => updateStep(step._key, { reviewDate: e.target.value })}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-4 flex flex-col gap-1.5">
                          <Label className="text-xs">Entrega</Label>
                          <Input
                            type="date"
                            value={step.dueDate}
                            onChange={(e) => updateStep(step._key, { dueDate: e.target.value })}
                            className="h-8 text-sm"
                          />
                        </div>

                        <div className="col-span-12 flex flex-col gap-1.5 mt-1">
                          <Label className="text-xs">Entregable esperado</Label>
                          <Select
                            value={step.taskProduct}
                            aria-label="Entregable esperado"
                            onChange={(e) => updateStep(step._key, { taskProduct: e.target.value as 'time_only' | 'DOCUMENTO' | 'DATO' })}
                            className="h-8 text-sm"
                          >
                            <option value="time_only">Ninguno (solo tiempo)</option>
                            <option value="DOCUMENTO">Documento / Informe</option>
                            <option value="DATO">Ingreso de mediciones / Datos</option>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ModalFooter className="mt-4 pt-4 border-t">
              <Button type="button" variant="ghost" onClick={() => setCreatorOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando...' : 'Crear Actividad y Pasos'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Editar actividad */}
      <Modal open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <ModalContent>
          <form onSubmit={handleEdit} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>Editar actividad</ModalTitle>
              <ModalDescription>Actualiza los datos de la actividad.</ModalDescription>
            </ModalHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-act-name">Nombre</Label>
                <Input id="edit-act-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-act-desc">Descripción</Label>
                <Textarea
                  id="edit-act-desc"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-act-assignee">Responsable</Label>
                <Select
                  id="edit-act-assignee"
                  aria-label="Responsable de la actividad"
                  value={editAssignee}
                  onChange={(e) => setEditAssignee(e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-act-review">Revisión</Label>
                  <Input
                    id="edit-act-review"
                    type="date"
                    value={editReviewDate}
                    onChange={(e) => setEditReviewDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-act-due">Entrega</Label>
                  <Input
                    id="edit-act-due"
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-act-points">Puntos estimados</Label>
                <Input
                  id="edit-act-points"
                  type="number"
                  min={0}
                  value={editPoints}
                  onChange={(e) => setEditPoints(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={savingEdit}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? 'Guardando…' : 'Guardar'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Borrar actividad */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Borrar actividad"
        description={
          deleting
            ? `¿Borrar la actividad "${deleting.name}"? Se eliminarán también sus pasos. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Borrar"
        onConfirm={handleDelete}
      />
    </div>
  );
}
