import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
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
import type { ServiceView } from '@/types/operations';
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
  const { create } = useTasks({ projectId });
  const { items: users } = useUsers({ limit: 100 });

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Main Activity
  const [mainName, setMainName] = useState('');
  const [mainDesc, setMainDesc] = useState('');
  const [mainServiceId, setMainServiceId] = useState('');
  
  // Steps
  const [steps, setSteps] = useState<StepForm[]>([newStepRow()]);

  const openCreator = () => {
    setMainName('');
    setMainDesc('');
    setMainServiceId('');
    setSteps([newStepRow()]);
    setCreatorOpen(true);
  };

  const addStep = () => {
    setSteps((prev) => [...prev, newStepRow()]);
  };

  const removeStep = (key: string) => {
    setSteps((prev) => prev.filter((s) => s._key !== key));
  };

  const updateStep = (key: string, patch: Partial<StepForm>) => {
    setSteps((prev) => prev.map((s) => (s._key === key ? { ...s, ...patch } : s)));
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

      <div className="border rounded-md p-8 bg-muted/20 flex flex-col items-center justify-center text-center">
        <EmptyState
          icon={ListChecks}
          title="Creador de Actividades"
          message="Utiliza el botón superior para crear una nueva actividad en cascada para este proyecto."
        />
      </div>

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
    </div>
  );
}
