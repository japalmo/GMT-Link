import { useState, type ReactNode, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/lib/api';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import { useProjects, useTasks, useProjectDocuments } from '@/hooks/use-operations';
import { useUsers } from '@/hooks/use-users';
import { useProfile } from '@/hooks/use-profile';
import {
  Plus,
  Filter,
  HelpCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Trash2,
  User,
  Edit2,
  Table,
  Play,
  Square,
  Kanban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/states';
import { SearchInput } from '@/components/ui/search-input';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from '@/components/ui/modal';
import type { TaskView, TaskStatus, TaskDataSpec } from '@/types/operations';

/** Etiqueta legible + variante de `Badge` por estado de tarea del backlog. */
const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  EN_PROGRESO: { label: 'En progreso', variant: 'info' },
  REVISADO: { label: 'Revisado', variant: 'neutral' },
  COMPLETADO: { label: 'Completado', variant: 'success' },
};

export function BacklogTab(): ReactNode {
  const { profile } = useProfile();
  const { projects } = useProjects();
  const { users } = useUsers();
  
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [wizardStep, setWizardStep] = useState(1);
  
  const [timeLogModalOpen, setTimeLogModalOpen] = useState(false);
  const [timeLogTask, setTimeLogTask] = useState<TaskView | null>(null);
  const [timeLogType, setTimeLogType] = useState<'start' | 'finish'>('start');
  const [timeLogNote, setTimeLogNote] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isSupervisorOrAdmin = useMemo(() => {
    if (!profile) return false;
    return (
      profile.roleKeys.includes('org_admin') ||
      profile.roleKeys.includes('supervisor') ||
      profile.roleKeys.includes('adm_contrato')
    );
  }, [profile]);

  const isOperator = useMemo(() => {
    if (!profile) return false;
    return profile.roleKeys.includes('operador') || profile.roleKeys.includes('operator');
  }, [profile]);

  const isIto = useMemo(() => {
    if (!profile) return false;
    return profile.roleKeys.includes('ito') || profile.roleKeys.includes('client_ito');
  }, [profile]);

  const isReadOnly = isIto || (!isSupervisorOrAdmin && !isOperator);

  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial states from search params, fallback to 'all' or empty
  const filterProject = searchParams.get('project') || 'all';
  const filterService = searchParams.get('service') || 'all';
  const filterAssignee = searchParams.get('assignee') || 'all';
  const filterSearch = searchParams.get('search') || '';

  const setFilterProject = (val: string) => {
    setSearchParams((prev) => {
      prev.set('project', val);
      prev.set('service', 'all'); // reset service on project change
      return prev;
    });
  };

  const setFilterService = (val: string) => {
    setSearchParams((prev) => {
      prev.set('service', val);
      return prev;
    });
  };

  const setFilterAssignee = (val: string) => {
    setSearchParams((prev) => {
      prev.set('assignee', val);
      return prev;
    });
  };

  const setFilterSearch = (val: string) => {
    setSearchParams((prev) => {
      if (val) {
        prev.set('search', val);
      } else {
        prev.delete('search');
      }
      return prev;
    });
  };

  const taskFilters = useMemo(() => {
    return {
      projectId: filterProject === 'all' ? undefined : filterProject,
      serviceId: filterService === 'all' ? undefined : filterService,
      assignedToId: filterAssignee === 'all' ? undefined : filterAssignee === 'unassigned' ? null : filterAssignee,
      search: filterSearch.trim() || undefined,
    };
  }, [filterProject, filterService, filterAssignee, filterSearch]);

  const { tasks, loading, create, updateStatus, update, remove, startTime, finishTime } = useTasks(taskFilters);

  const { documents: projectDocs, refetch: refetchDocs } = useProjectDocuments(
    filterProject !== 'all' ? filterProject : undefined,
    filterService !== 'all' ? filterService : undefined
  );

  // Modal states
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskView | null>(null);
  const [pointsPromptOpen, setPointsPromptOpen] = useState(false);
  const [pointsPromptTask, setPointsPromptTask] = useState<TaskView | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  
  // Form states - Create
  const [taskName, setTaskName] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskProjId, setTaskProjId] = useState('');
  const [taskSrvId, setTaskSrvId] = useState('');
  const [taskAssignedId, setTaskAssignedId] = useState('');
  const [taskEstPoints, setTaskEstPoints] = useState(10);
  const [taskRecurrence, setTaskRecurrence] = useState('');
  const [taskClientId, setTaskClientId] = useState('');
  const [taskProduct, setTaskProduct] = useState<'time_only' | 'pdf_report' | 'file_generic' | 'custom_metrics'>('time_only');
  const [deliverableFile, setDeliverableFile] = useState<File | null>(null);
  const [metricCotaEspejo, setMetricCotaEspejo] = useState<string>('');
  const [metricVolSalmuera, setMetricVolSalmuera] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Form states - ITO Request
  const [itoRequestOpen, setItoRequestOpen] = useState(false);
  const [itoName, setItoName] = useState('');
  const [itoDesc, setItoDesc] = useState('');
  const [itoProjId, setItoProjId] = useState('');
  const [itoProduct, setItoProduct] = useState<'time_only' | 'pdf_report' | 'file_generic' | 'custom_metrics'>('time_only');
  const [itoFormError, setItoFormError] = useState<string | null>(null);

  // Form states - Points Completion Prompt
  const [actualPointsVal, setActualPointsVal] = useState<number>(10);

  // Form states - Edit
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAssignedId, setEditAssignedId] = useState('');
  const [editEstPoints, setEditEstPoints] = useState(10);
  const [editActPoints, setEditActPoints] = useState<number | undefined>(undefined);
  const [editRecurrence, setEditRecurrence] = useState('');
  const [editClientId, setEditClientId] = useState('');

  // Dynamically select services based on current project select in creation
  const projectServices = useMemo(() => {
    if (!taskProjId) return [];
    const proj = projects.find((p) => p.id === taskProjId);
    return proj?.services || [];
  }, [taskProjId, projects]);

  const filterProjectServices = useMemo(() => {
    if (filterProject === 'all') return [];
    const proj = projects.find((p) => p.id === filterProject);
    return proj?.services || [];
  }, [filterProject, projects]);

  // Group tasks by status
  const columns = useMemo(() => {
    const list: Record<TaskStatus, TaskView[]> = {
      PENDIENTE: [],
      EN_PROGRESO: [],
      REVISADO: [],
      COMPLETADO: [],
    };
    tasks.forEach((t) => {
      if (list[t.status]) {
        list[t.status].push(t);
      }
    });
    return list;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (isIto) {
      return tasks.filter((t) => t.status === 'COMPLETADO');
    }
    return tasks;
  }, [tasks, isIto]);

  const visibleColumns = useMemo((): TaskStatus[] => {
    if (isIto) {
      return ['COMPLETADO'];
    }
    return ['PENDIENTE', 'EN_PROGRESO', 'REVISADO', 'COMPLETADO'];
  }, [isIto]);

  const handleItoRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setItoFormError(null);
    if (!itoName || !itoProjId) {
      setItoFormError('Por favor completa el nombre del requerimiento y selecciona un proyecto.');
      return;
    }

    try {
      let dataSpec: TaskDataSpec | null = null;
      if (itoProduct === 'time_only') {
        dataSpec = { type: 'time_only', label: 'Solo registro de tiempo' };
      } else if (itoProduct === 'pdf_report') {
        dataSpec = { type: 'pdf_report', label: 'Informe en PDF' };
      } else if (itoProduct === 'file_generic') {
        dataSpec = { type: 'file_generic', label: 'Archivo genérico' };
      } else if (itoProduct === 'custom_metrics') {
        dataSpec = {
          type: 'custom_metrics',
          label: 'Ingreso de datos / Mediciones',
          fields: {
            cota_espejo: 'Cota espejo (m)',
            vol_salmuera: 'Volumen salmuera (m³)',
          },
        };
      }

      await create({
        name: itoName,
        description: itoDesc.trim() || undefined,
        projectId: itoProjId,
        clientUserId: profile?.id,
        estimatedPoints: 10,
        dataSpec,
      });

      setItoName('');
      setItoDesc('');
      setItoProjId('');
      setItoProduct('time_only');
      setItoRequestOpen(false);
      toast.success('Solicitud de actividad creada correctamente.');
    } catch (err) {
      setItoFormError(err instanceof Error ? err.message : 'Error al crear la solicitud.');
    }
  };

  // Compute column points totals
  const columnPoints = useMemo(() => {
    const pts: Record<TaskStatus, { est: number; act: number }> = {
      PENDIENTE: { est: 0, act: 0 },
      EN_PROGRESO: { est: 0, act: 0 },
      REVISADO: { est: 0, act: 0 },
      COMPLETADO: { est: 0, act: 0 },
    };
    tasks.forEach((t) => {
      pts[t.status].est += t.estimatedPoints;
      pts[t.status].act += t.actualPoints ?? t.estimatedPoints;
    });
    return pts;
  }, [tasks]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!taskName || !taskProjId) {
      setFormError('Por favor completa el nombre de la tarea y selecciona un proyecto.');
      return;
    }

    try {
      let dataSpec: TaskDataSpec | null = null;
      if (taskProduct === 'time_only') {
        dataSpec = { type: 'time_only', label: 'Solo registro de tiempo' };
      } else if (taskProduct === 'pdf_report') {
        dataSpec = { type: 'pdf_report', label: 'Informe en PDF' };
      } else if (taskProduct === 'file_generic') {
        dataSpec = { type: 'file_generic', label: 'Archivo genérico' };
      } else if (taskProduct === 'custom_metrics') {
        dataSpec = {
          type: 'custom_metrics',
          label: 'Ingreso de datos / Mediciones',
          fields: {
            cota_espejo: 'Cota espejo (m)',
            vol_salmuera: 'Volumen salmuera (m³)',
          },
        };
      }

      await create({
        name: taskName,
        description: taskDesc.trim() || undefined,
        projectId: taskProjId,
        serviceId: taskSrvId || undefined,
        assignedToId: taskAssignedId || undefined,
        estimatedPoints: Number(taskEstPoints),
        recurrence: taskRecurrence.trim() || undefined,
        clientUserId: taskClientId || undefined,
        dataSpec,
      });

      // Clear form
      setTaskName('');
      setTaskDesc('');
      setTaskProjId('');
      setTaskSrvId('');
      setTaskAssignedId('');
      setTaskEstPoints(10);
      setTaskRecurrence('');
      setTaskClientId('');
      setTaskProduct('time_only');
      setWizardStep(1);
      setCreateOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear la tarea.');
    }
  };

  const handleOpenEdit = (t: TaskView) => {
    setEditTask(t);
    setEditName(t.name);
    setEditDesc(t.description || '');
    setEditAssignedId(t.assignedToId || '');
    setEditEstPoints(t.estimatedPoints);
    setEditActPoints(t.actualPoints ?? undefined);
    setEditRecurrence(t.recurrence || '');
    setEditClientId(t.clientUserId || '');
  };

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTask) return;
    try {
      await update(editTask.id, {
        name: editName,
        description: editDesc.trim() || undefined,
        assignedToId: editAssignedId || undefined,
        estimatedPoints: Number(editEstPoints),
        actualPoints: editActPoints !== undefined ? Number(editActPoints) : undefined,
        recurrence: editRecurrence.trim() || undefined,
        clientUserId: editClientId || undefined,
      });
      setEditTask(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar la tarea.');
    }
  };

  const handleMoveStatus = async (t: TaskView, nextStatus: TaskStatus) => {
    if (nextStatus === 'COMPLETADO') {
      // Prompt for actual points to see variance
      setPointsPromptTask(t);
      setActualPointsVal(t.estimatedPoints);
      setPointsPromptOpen(true);
    } else {
      try {
        await updateStatus(t.id, nextStatus);
        toast.success('Estado de la tarea actualizado.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al mover el estado de la tarea.');
      }
    }
  };

  const handleCompleteWithPoints = async () => {
    if (!pointsPromptTask) return;
    try {
      await updateStatus(pointsPromptTask.id, 'COMPLETADO', Number(actualPointsVal));
      setPointsPromptOpen(false);
      setPointsPromptTask(null);
      toast.success('Tarea completada con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al completar la tarea.');
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await remove(id);
      toast.success('Tarea eliminada con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar la tarea.');
    } finally {
      setDeleteTaskId(null);
    }
  };

  const handleTimeLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!timeLogTask) return;
    try {
      const note = timeLogNote.trim() || undefined;
      if (timeLogType === 'start') {
        await startTime(timeLogTask.id, note);
        toast.success('Actividad iniciada.');
      } else {
        await finishTime(timeLogTask.id, note);
        toast.success('Actividad finalizada.');

        // Subir archivo si se especificó y la tarea lo requiere
        if (deliverableFile && (timeLogTask.dataSpec?.type === 'pdf_report' || timeLogTask.dataSpec?.type === 'file_generic')) {
          await api.uploadProjectDocument({
            name: `Entregable - ${timeLogTask.name}`,
            projectId: timeLogTask.projectId,
            serviceId: timeLogTask.serviceId || '',
            documentType: 'INFORME',
            areaCode: 'OPS',
          }, deliverableFile);
          toast.success('Entregable subido con éxito.');
        }

        // Ingresar mediciones de cubicación si se especificaron
        if (timeLogTask.dataSpec?.type === 'custom_metrics' && (metricCotaEspejo || metricVolSalmuera)) {
          const elementId = timeLogTask.elementId || undefined;
          const phaseId = timeLogTask.phaseId || undefined;

          if (phaseId && elementId) {
            const vars = await api.listMetricVariables(phaseId);
            const cotaVar = vars.find(v => v.code === 'cota_espejo');
            const volVar = vars.find(v => v.code === 'vol_total_salmuera');

            const points: Parameters<typeof api.submitMetricDataPoints>[0] = [];
            if (cotaVar && metricCotaEspejo) {
              points.push({ value: metricCotaEspejo, variableId: cotaVar.id, elementId, phaseId, taskId: timeLogTask.id });
            }
            if (volVar && metricVolSalmuera) {
              points.push({ value: metricVolSalmuera, variableId: volVar.id, elementId, phaseId, taskId: timeLogTask.id });
            }

            if (points.length > 0) {
              await api.submitMetricDataPoints(points);
              toast.success('Mediciones de cubicación registradas.');
            }
          }
        }
      }
      setTimeLogModalOpen(false);
      setTimeLogTask(null);
      setTimeLogNote('');
      setDeliverableFile(null);
      setMetricCotaEspejo('');
      setMetricVolSalmuera('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar actividad.');
    }
  };

  const formatElapsedTime = (startedAt: string) => {
    const elapsed = now - new Date(startedAt).getTime();
    if (elapsed < 0) return '00:00';
    const secs = Math.floor(elapsed / 1000) % 60;
    const mins = Math.floor(elapsed / (1000 * 60)) % 60;
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    return `${hours > 0 ? `${hours}h ` : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Barra de Filtros */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/60 p-4 shadow-xs backdrop-blur-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="size-4 text-primary" />
            <span>Filtros de Backlog</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40 mr-2">
              <Button
                variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setViewMode('kanban')}
              >
                <Kanban className="size-3.5 mr-1.5" />
                Kanban
              </Button>
              <Button
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setViewMode('table')}
              >
                <Table className="size-3.5 mr-1.5" />
                Tabla
              </Button>
            </div>
            {!isReadOnly && (
              <Button size="sm" onClick={() => { setWizardStep(1); setCreateOpen(true); }}>
                <Plus className="size-4 mr-2" />
                Nueva Tarea
              </Button>
            )}
            {isIto && (
              <Button size="sm" onClick={() => { setItoName(''); setItoDesc(''); setItoProjId(''); setItoProduct('time_only'); setItoFormError(null); setItoRequestOpen(true); }}>
                <Plus className="size-4 mr-2" />
                Solicitud de Actividad
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-proj" className="text-xs">Proyecto</Label>
            <Select
              id="filter-proj"
              aria-label="Filtrar backlog por proyecto"
              value={filterProject}
              onChange={(e) => {
                setFilterProject(e.target.value);
                setFilterService('all'); // reset service on project change
              }}
            >
              <option value="all">Todos los proyectos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-srv" className="text-xs">Servicio</Label>
            <Select
              id="filter-srv"
              aria-label="Filtrar backlog por servicio"
              value={filterService}
              disabled={filterProject === 'all'}
              onChange={(e) => setFilterService(e.target.value)}
            >
              <option value="all">Todos los servicios</option>
              {filterProjectServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-user" className="text-xs">Responsable</Label>
            <Select
              id="filter-user"
              aria-label="Filtrar backlog por responsable"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
            >
              <option value="all">Todos los responsables</option>
              <option value="unassigned">Sin Asignar</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-search" className="text-xs">Buscar</Label>
            <SearchInput
              id="filter-search"
              label="Buscar tarea por nombre"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Buscar por nombre..."
            />
          </div>
        </div>
      </div>

      {/* Tablero Kanban o Tabla */}
{loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-96 animate-pulse rounded-xl bg-muted/40 border border-border" />
          ))}
        </div>
      ) : viewMode === 'kanban' ? (
        <div className={`grid grid-cols-1 gap-6 ${isIto ? 'max-w-2xl mx-auto w-full' : 'md:grid-cols-4'}`}>
          {visibleColumns.map((status) => {
            const columnTasks = columns[status];
            const pts = columnPoints[status];
            const isCompletedCol = status === 'COMPLETADO';
            return (
              <div
                key={status}
                className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-4 min-h-[500px]"
              >
                {/* Column Header */}
                <div className="flex flex-col gap-1 border-b pb-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm tracking-wide text-foreground">
                      {TASK_STATUS_META[status].label}
                    </span>
                    <Badge variant={TASK_STATUS_META[status].variant}>
                      {columnTasks.length}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1 font-medium">
                    <span>Pts: {isCompletedCol ? pts.act : pts.est}</span>
                    {isCompletedCol && pts.act !== pts.est && (
                      <span className="text-amber-500 text-[10px] flex items-center gap-0.5">
                        <AlertTriangle className="size-2.5" />
                        Var: {pts.act - pts.est > 0 ? `+${pts.act - pts.est}` : pts.act - pts.est}
                      </span>
                    )}
                  </div>
                </div>

                {/* Column Cards Container */}
                <div className="flex flex-col gap-3 overflow-y-auto max-h-[600px] pr-1">
                  {columnTasks.map((t) => {
                    const activeLogForUser = profile && t.timeLogs?.find((log) => log.userId === profile.id && log.endedAt === null);
                    const hasVariance = t.actualPoints !== null && t.actualPoints !== t.estimatedPoints;
                    const variance = t.actualPoints !== null ? t.actualPoints - t.estimatedPoints : 0;
                    
                    return (
                      <Card
                        key={t.id}
                        className="group hover:border-primary/20 transition-all bg-card/75 border border-border shadow-xs hover:shadow-sm"
                      >
                        <CardHeader className="p-3 pb-2 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-medium text-sm text-foreground leading-tight group-hover:text-primary transition-colors">
                              {t.name}
                            </h4>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className="text-[10px] py-0 px-1 border-primary/20 bg-primary/5 text-primary shrink-0">
                              {t.project.code}
                            </Badge>
                            {t.service && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1 border-muted bg-muted/30 text-muted-foreground shrink-0">
                                {t.service.code}
                              </Badge>
                            )}
                          </div>
                        </CardHeader>

                        {t.description && (
                          <CardContent className="px-3 py-0">
                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                              {t.description}
                            </p>
                          </CardContent>
                        )}

                        <CardFooter className="p-3 pt-3 flex flex-col gap-3 border-t mt-3 bg-muted/10">
                          {/* User assignments & points details */}
                          <div className="flex justify-between items-center w-full text-xs">
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <User className="size-3 text-muted-foreground/60" />
                              <span className="truncate max-w-[100px]" title={t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Sin asignar'}>
                                {t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName.substring(0,1)}.` : 'Sin asignar'}
                              </span>
                            </div>
                            <div className="font-medium flex flex-col items-end">
                              <span className="text-foreground">Est: {t.estimatedPoints} Pts</span>
                              {t.actualPoints !== null && (
                                <span className={hasVariance ? (variance > 0 ? 'text-destructive' : 'text-emerald-500') : 'text-muted-foreground'}>
                                  Real: {t.actualPoints} Pts
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Time logs tracking controls */}
                          {!isReadOnly && (
                            <div className="flex items-center justify-between w-full border-t border-border/40 pt-2 mt-1">
                              {activeLogForUser ? (
                                <div className="flex items-center gap-1 text-red-500 font-mono text-xs">
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                  </span>
                                  <span>{formatElapsedTime(activeLogForUser.startedAt)}</span>
                                </div>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">Tiempo de tarea</span>
                              )}
                              <Button
                                size="sm"
                                variant={activeLogForUser ? 'destructive' : 'outline'}
                                className="h-6 px-2 text-[10px] gap-1"
                                onClick={() => {
                                  setTimeLogTask(t);
                                  setTimeLogType(activeLogForUser ? 'finish' : 'start');
                                  setTimeLogNote('');
                                  setTimeLogModalOpen(true);
                                }}
                                disabled={!isSupervisorOrAdmin && t.assignedToId !== profile?.id}
                              >
                                {activeLogForUser ? (
                                  <>
                                    <Square className="size-2.5 fill-current" />
                                    Detener
                                  </>
                                ) : (
                                  <>
                                    <Play className="size-2.5 fill-current" />
                                    Iniciar
                                  </>
                                )}
                              </Button>
                            </div>
                          )}

                          {/* Deliverable link / upload for completed/reviewed tasks */}
                          {(t.status === 'COMPLETADO' || t.status === 'REVISADO') && (t.dataSpec?.type === 'pdf_report' || t.dataSpec?.type === 'file_generic') && (
                            <div className="flex flex-col gap-1.5 w-full border-t border-border/40 pt-2 mt-1">
                              <span className="text-[10px] font-semibold text-muted-foreground">
                                Entregable esperado: {t.dataSpec?.label}
                              </span>
                              {(() => {
                                const taskDoc = projectDocs?.find(d => d.name === `Entregable - ${t.name}`);
                                return (
                                  <div className="flex flex-col gap-1.5">
                                    {taskDoc ? (
                                      <a
                                        href={taskDoc.fileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-primary hover:underline flex items-center gap-1 font-medium bg-primary/5 border border-primary/10 rounded-md p-1.5"
                                      >
                                        <Plus className="size-3 rotate-45 text-primary" />
                                        Descargar {t.dataSpec?.type === 'pdf_report' ? 'PDF' : 'Archivo'}
                                      </a>
                                    ) : (
                                      <span className="text-[10px] text-amber-500 italic">Pendiente de subida</span>
                                    )}
                                    
                                    {!isReadOnly && (t.assignedToId === profile?.id || isSupervisorOrAdmin) && (
                                      <div className="flex items-center gap-2">
                                        <Input
                                          type="file"
                                          accept={t.dataSpec?.type === 'pdf_report' ? '.pdf' : '*'}
                                          className="h-7 text-[10px] py-0.5 bg-card border-dashed border-border"
                                          onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            try {
                                              await api.uploadProjectDocument({
                                                name: `Entregable - ${t.name}`,
                                                projectId: t.projectId,
                                                serviceId: t.serviceId || '',
                                                documentType: 'INFORME',
                                                areaCode: 'OPS',
                                              }, file);
                                              toast.success('Entregable subido con éxito.');
                                              e.target.value = '';
                                              void refetchDocs();
                                            } catch (err) {
                                              toast.error(err instanceof Error ? err.message : 'Error al subir entregable.');
                                            }
                                          }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Quick Actions */}
                          <div className="flex justify-between items-center w-full">
                            <div className="flex gap-1.5">
                              {!isReadOnly && (isSupervisorOrAdmin || t.createdById === profile?.id || t.assignedToId === profile?.id) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-muted-foreground hover:text-foreground"
                                  onClick={() => handleOpenEdit(t)}
                                  title="Editar"
                                >
                                  <Edit2 className="size-3" />
                                </Button>
                              )}
                              {!isReadOnly && (isSupervisorOrAdmin || t.createdById === profile?.id) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-muted-foreground hover:text-destructive"
                                  onClick={() => setDeleteTaskId(t.id)}
                                  title="Eliminar"
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              )}
                            </div>

                            {/* Transition buttons */}
                            <div className="flex gap-1">
                              {!isReadOnly && (isSupervisorOrAdmin || t.assignedToId === profile?.id) && status !== 'PENDIENTE' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6"
                                  onClick={() => {
                                    const states: TaskStatus[] = ['PENDIENTE', 'EN_PROGRESO', 'REVISADO', 'COMPLETADO'];
                                    const prev = states[states.indexOf(status) - 1];
                                    if (prev) void handleMoveStatus(t, prev);
                                  }}
                                  title="Retroceder estado"
                                >
                                  <ArrowLeft className="size-3" />
                                </Button>
                              )}
                              {!isReadOnly && (isSupervisorOrAdmin || t.assignedToId === profile?.id) && status !== 'COMPLETADO' && (
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="size-6 bg-card border-border hover:border-primary/30"
                                  onClick={() => {
                                    const states: TaskStatus[] = ['PENDIENTE', 'EN_PROGRESO', 'REVISADO', 'COMPLETADO'];
                                    const next = states[states.indexOf(status) + 1];
                                    if (next) void handleMoveStatus(t, next);
                                  }}
                                  title="Avanzar estado"
                                >
                                  <ArrowRight className="size-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardFooter>
                      </Card>
                    );
                  })}

                  {columnTasks.length === 0 && (
                    <EmptyState
                      icon={HelpCircle}
                      message="Sin tareas"
                      className="rounded-lg border border-dashed border-border bg-card/10 p-8"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Vista de Tabla */
        <div className="overflow-x-auto rounded-xl border border-border bg-card/40">
          <table className="w-full border-collapse text-sm text-left">
            <thead className="bg-muted/50 border-b border-border text-xs font-semibold uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Tarea</th>
                <th className="p-3">Proyecto / Servicio</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Est.</th>
                <th className="p-3">Real</th>
                <th className="p-3">Responsable</th>
                <th className="p-3">Registro de Tiempo</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleTasks.map((t) => {
                const activeLogForUser = profile && t.timeLogs?.find((log) => log.userId === profile.id && log.endedAt === null);
                const hasVariance = t.actualPoints !== null && t.actualPoints !== t.estimatedPoints;
                const variance = t.actualPoints !== null ? t.actualPoints - t.estimatedPoints : 0;
                return (
                  <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                    <td className="p-3 font-medium">
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground">{t.name}</span>
                        {t.description && <span className="text-xs text-muted-foreground line-clamp-1">{t.description}</span>}
                        {/* Deliverable link / upload for completed/reviewed tasks in Table */}
                        {(t.status === 'COMPLETADO' || t.status === 'REVISADO') && (t.dataSpec?.type === 'pdf_report' || t.dataSpec?.type === 'file_generic') && (
                          <div className="mt-1 flex flex-col gap-1 bg-muted/20 border rounded-lg p-2 max-w-xs">
                            <span className="text-[9px] text-muted-foreground font-semibold">
                              Entregable ({t.dataSpec?.label}):
                            </span>
                            {(() => {
                              const taskDoc = projectDocs?.find(d => d.name === `Entregable - ${t.name}`);
                              return (
                                <div className="flex flex-col gap-1.5">
                                  {taskDoc ? (
                                    <a
                                      href={taskDoc.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[11px] text-primary hover:underline font-medium"
                                    >
                                      Descargar entregable
                                    </a>
                                  ) : (
                                    <span className="text-[10px] text-amber-500 italic">Pendiente</span>
                                  )}
                                  
                                  {!isReadOnly && (t.assignedToId === profile?.id || isSupervisorOrAdmin) && (
                                    <Input
                                      type="file"
                                      accept={t.dataSpec?.type === 'pdf_report' ? '.pdf' : '*'}
                                      className="h-6 text-[9px] py-0 bg-card border-dashed border-border"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        try {
                                          await api.uploadProjectDocument({
                                            name: `Entregable - ${t.name}`,
                                            projectId: t.projectId,
                                            serviceId: t.serviceId || '',
                                            documentType: 'INFORME',
                                            areaCode: 'OPS',
                                          }, file);
                                          toast.success('Entregable subido con éxito.');
                                          e.target.value = '';
                                          void refetchDocs();
                                        } catch (err) {
                                          toast.error(err instanceof Error ? err.message : 'Error al subir entregable.');
                                        }
                                      }}
                                    />
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px] py-0 px-1 border-primary/20 bg-primary/5 text-primary">
                          {t.project.code}
                        </Badge>
                        {t.service && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1 border-muted bg-muted/30 text-muted-foreground">
                            {t.service.code}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant={TASK_STATUS_META[t.status].variant}>
                        {TASK_STATUS_META[t.status].label}
                      </Badge>
                    </td>
                    <td className="p-3 font-medium font-mono">{t.estimatedPoints}</td>
                    <td className="p-3 font-medium font-mono">
                      {t.actualPoints !== null ? (
                        <span className={hasVariance ? (variance > 0 ? 'text-destructive font-semibold' : 'text-emerald-500 font-semibold') : 'text-muted-foreground'}>
                          {t.actualPoints}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 text-xs">
                        <User className="size-3 text-muted-foreground/60" />
                        <span>{t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Sin asignar'}</span>
                      </div>
                    </td>
                    <td className="p-3 font-medium">
                      {!isReadOnly && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={activeLogForUser ? 'destructive' : 'outline'}
                            className="h-7 px-2 text-[10px] gap-1"
                            onClick={() => {
                              setTimeLogTask(t);
                              setTimeLogType(activeLogForUser ? 'finish' : 'start');
                              setTimeLogNote('');
                              setTimeLogModalOpen(true);
                            }}
                            disabled={!isSupervisorOrAdmin && t.assignedToId !== profile?.id}
                          >
                            {activeLogForUser ? <Square className="size-2.5 fill-current" /> : <Play className="size-2.5 fill-current" />}
                            {activeLogForUser ? 'Detener' : 'Iniciar'}
                          </Button>
                          {activeLogForUser && (
                            <span className="text-red-500 font-mono text-xs flex items-center gap-1">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                              </span>
                              {formatElapsedTime(activeLogForUser.startedAt)}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        {!isReadOnly && (isSupervisorOrAdmin || t.createdById === profile?.id || t.assignedToId === profile?.id) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => handleOpenEdit(t)}
                            title="Editar"
                          >
                            <Edit2 className="size-3.5" />
                          </Button>
                        )}
                        {!isReadOnly && (isSupervisorOrAdmin || t.createdById === profile?.id) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTaskId(t.id)}
                            title="Eliminar"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                        {/* Status Shift Buttons */}
                        {!isReadOnly && (isSupervisorOrAdmin || t.assignedToId === profile?.id) && (
                          <>
                            {t.status !== 'PENDIENTE' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => {
                                  const states: TaskStatus[] = ['PENDIENTE', 'EN_PROGRESO', 'REVISADO', 'COMPLETADO'];
                                  const prev = states[states.indexOf(t.status) - 1];
                                  if (prev) void handleMoveStatus(t, prev);
                                }}
                                title="Retroceder"
                              >
                                <ArrowLeft className="size-3.5" />
                              </Button>
                            )}
                            {t.status !== 'COMPLETADO' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => {
                                  const states: TaskStatus[] = ['PENDIENTE', 'EN_PROGRESO', 'REVISADO', 'COMPLETADO'];
                                  const next = states[states.indexOf(t.status) + 1];
                                  if (next) void handleMoveStatus(t, next);
                                }}
                                title="Avanzar"
                              >
                                <ArrowRight className="size-3.5" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleTasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    No se encontraron tareas con los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL CREAR TAREA (WIZARD) */}
      <Modal open={createOpen} onOpenChange={setCreateOpen}>
        <ModalContent className="max-w-md bg-card border border-border shadow-lg">
          <form onSubmit={handleCreateTask}>
            <ModalHeader>
              <ModalTitle>Nueva Tarea de Backlog</ModalTitle>
              <ModalDescription>
                Paso {wizardStep} de 4 — {wizardStep === 1 ? 'Detalles Básicos' : wizardStep === 2 ? 'Proyecto & Estimación' : wizardStep === 3 ? 'Producto / Entregable' : 'Asignación & Mandante'}
              </ModalDescription>
            </ModalHeader>
            <div className="flex flex-col gap-4 py-4 min-h-[250px]">
              {formError && (
                <Alert variant="destructive" live>
                  {formError}
                </Alert>
              )}

              {wizardStep === 1 && (
                <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="task-name">Nombre de la Tarea</Label>
                    <Input
                      id="task-name"
                      required
                      value={taskName}
                      onChange={(e) => setTaskName(e.target.value)}
                      placeholder="Ej. Revisar informe de resistividad"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="task-desc">Descripción</Label>
                    <Textarea
                      id="task-desc"
                      value={taskDesc}
                      onChange={(e) => setTaskDesc(e.target.value)}
                      className="min-h-24"
                      placeholder="Detalles sobre lo que se espera..."
                    />
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="task-proj">Proyecto</Label>
                    <Select
                      id="task-proj"
                      aria-label="Proyecto de la tarea"
                      required
                      value={taskProjId}
                      onChange={(e) => {
                        setTaskProjId(e.target.value);
                        setTaskSrvId(''); // reset service
                      }}
                    >
                      <option value="">Selecciona proyecto</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="task-srv">Servicio (Opcional)</Label>
                    <Select
                      id="task-srv"
                      aria-label="Servicio de la tarea"
                      value={taskSrvId}
                      disabled={!taskProjId}
                      onChange={(e) => setTaskSrvId(e.target.value)}
                    >
                      <option value="">Ninguno</option>
                      {projectServices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="task-est-pts">Puntos Estimados</Label>
                      <Input
                        id="task-est-pts"
                        type="number"
                        min={0}
                        required
                        value={taskEstPoints}
                        onChange={(e) => setTaskEstPoints(Number(e.target.value))}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="task-rec">Recurrencia (Opcional)</Label>
                      <Input
                        id="task-rec"
                        value={taskRecurrence}
                        onChange={(e) => setTaskRecurrence(e.target.value)}
                        placeholder="Ej. 0 0 * * 1 (Cada Lunes)"
                      />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="task-product">Producto / Entregable Esperado</Label>
                    <Select
                      id="task-product"
                      aria-label="Producto o entregable esperado de la tarea"
                      required
                      value={taskProduct}
                      onChange={(e) =>
                        setTaskProduct(
                          e.target.value as 'time_only' | 'pdf_report' | 'file_generic' | 'custom_metrics',
                        )
                      }
                    >
                      <option value="time_only">Solo registro de tiempo</option>
                      <option value="pdf_report">Informe en PDF</option>
                      <option value="file_generic">Archivo genérico / Entregable pesado</option>
                      <option value="custom_metrics">Ingreso de datos / Mediciones (Atacama)</option>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Define qué debe ingresar u ocurrir al finalizar la tarea.
                    </p>
                  </div>
                </div>
              )}

              {wizardStep === 4 && (
                <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="task-assigned">Responsable de Ejecución</Label>
                    <Select
                      id="task-assigned"
                      aria-label="Responsable de ejecución de la tarea"
                      value={taskAssignedId}
                      onChange={(e) => setTaskAssignedId(e.target.value)}
                    >
                      <option value="">Sin Asignar</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="task-client">Mandante/ITO Solicitante</Label>
                    <Select
                      id="task-client"
                      aria-label="Mandante o ITO solicitante"
                      value={taskClientId}
                      onChange={(e) => setTaskClientId(e.target.value)}
                    >
                      <option value="">Ninguno</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="border rounded-lg p-3 bg-muted/20 text-xs flex flex-col gap-2 mt-2">
                    <span className="font-semibold text-foreground">Resumen de Tarea:</span>
                    <div><span className="text-muted-foreground">Nombre:</span> {taskName}</div>
                    {taskProjId && (
                      <div>
                        <span className="text-muted-foreground">Proyecto:</span>{' '}
                        {projects.find((p) => p.id === taskProjId)?.name}
                      </div>
                    )}
                    <div><span className="text-muted-foreground">Puntos Estimados:</span> {taskEstPoints} pts</div>
                    <div>
                      <span className="text-muted-foreground">Entregable esperado:</span>{' '}
                      {taskProduct === 'time_only' ? 'Solo registro de tiempo' :
                       taskProduct === 'pdf_report' ? 'Informe en PDF' :
                       taskProduct === 'file_generic' ? 'Archivo genérico' :
                       'Mediciones de cubicación'}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <ModalFooter className="flex justify-between items-center gap-2 border-t pt-4">
              <div>
                {wizardStep > 1 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setWizardStep(wizardStep - 1)}>
                    Anterior
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setCreateOpen(false); setWizardStep(1); }}>
                  Cancelar
                </Button>
                {wizardStep < 4 ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (wizardStep === 1 && !taskName) {
                        toast.error('Completa el nombre de la tarea.');
                        return;
                      }
                      if (wizardStep === 2 && !taskProjId) {
                        toast.error('Selecciona un proyecto.');
                        return;
                      }
                      setWizardStep(wizardStep + 1);
                    }}
                  >
                    Siguiente
                  </Button>
                ) : (
                  <Button type="submit" size="sm">Crear Tarea</Button>
                )}
              </div>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* MODAL SOLICITUD DE ACTIVIDAD (ITO) */}
      <Modal open={itoRequestOpen} onOpenChange={setItoRequestOpen}>
        <ModalContent className="max-w-md bg-card border border-border shadow-lg">
          <form onSubmit={handleItoRequestSubmit}>
            <ModalHeader>
              <ModalTitle>Solicitud de Actividad / Requerimiento</ModalTitle>
              <ModalDescription>
                Describe el requerimiento y lo que esperas como producto final para que el Supervisor lo gestione.
              </ModalDescription>
            </ModalHeader>
            <div className="flex flex-col gap-4 py-4 min-h-[250px]">
              {itoFormError && (
                <Alert variant="destructive" live>
                  {itoFormError}
                </Alert>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ito-name">Nombre del Requerimiento</Label>
                <Input
                  id="ito-name"
                  required
                  value={itoName}
                  onChange={(e) => setItoName(e.target.value)}
                  placeholder="Ej. Medición de espesor de sal de poza R2"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ito-desc">Descripción detallada</Label>
                <Textarea
                  id="ito-desc"
                  value={itoDesc}
                  onChange={(e) => setItoDesc(e.target.value)}
                  className="min-h-24"
                  placeholder="Detalla qué necesitas y por qué..."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ito-proj">Proyecto Mandante</Label>
                <Select
                  id="ito-proj"
                  aria-label="Proyecto mandante del requerimiento"
                  required
                  value={itoProjId}
                  onChange={(e) => setItoProjId(e.target.value)}
                >
                  <option value="">Selecciona proyecto</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ito-product">Producto / Entregable Esperado</Label>
                <Select
                  id="ito-product"
                  aria-label="Producto o entregable esperado del requerimiento"
                  required
                  value={itoProduct}
                  onChange={(e) =>
                    setItoProduct(
                      e.target.value as 'time_only' | 'pdf_report' | 'file_generic' | 'custom_metrics',
                    )
                  }
                >
                  <option value="time_only">Solo registro de tiempo</option>
                  <option value="pdf_report">Informe en PDF</option>
                  <option value="file_generic">Archivo genérico / Entregable pesado</option>
                  <option value="custom_metrics">Ingreso de datos / Mediciones (Atacama)</option>
                </Select>
              </div>
            </div>
            <ModalFooter className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => setItoRequestOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm">Enviar Solicitud</Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* MODAL EDITAR TAREA */}
      <Modal open={editTask !== null} onOpenChange={(open) => !open && setEditTask(null)}>
        <ModalContent className="max-w-md">
          {editTask && (
            <form onSubmit={handleUpdateTask}>
              <ModalHeader>
                <ModalTitle>Editar Tarea</ModalTitle>
                <ModalDescription>Edita los detalles y puntos de la tarea.</ModalDescription>
              </ModalHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-name">Nombre de la Tarea</Label>
                  <Input
                    id="edit-name"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-desc">Descripción</Label>
                  <Textarea
                    id="edit-desc"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="min-h-20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-assigned">Responsable</Label>
                    <Select
                      id="edit-assigned"
                      aria-label="Responsable de la tarea"
                      value={editAssignedId}
                      onChange={(e) => setEditAssignedId(e.target.value)}
                    >
                      <option value="">Sin Asignar</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-est-pts">Puntos Estimados</Label>
                    <Input
                      id="edit-est-pts"
                      type="number"
                      min={0}
                      required
                      value={editEstPoints}
                      onChange={(e) => setEditEstPoints(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-act-pts">Puntos Reales</Label>
                    <Input
                      id="edit-act-pts"
                      type="number"
                      min={0}
                      value={editActPoints ?? ''}
                      onChange={(e) => setEditActPoints(e.target.value === '' ? undefined : Number(e.target.value))}
                      placeholder="Sin completar"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-rec">Recurrencia</Label>
                    <Input
                      id="edit-rec"
                      value={editRecurrence}
                      onChange={(e) => setEditRecurrence(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-client">Mandante/ITO Solicitante</Label>
                  <Select
                    id="edit-client"
                    aria-label="Mandante o ITO solicitante"
                    value={editClientId}
                    onChange={(e) => setEditClientId(e.target.value)}
                  >
                    <option value="">Ninguno</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <ModalFooter>
                <Button type="button" variant="ghost" onClick={() => setEditTask(null)}>
                  Cancelar
                </Button>
                <Button type="submit">Guardar Cambios</Button>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>

      {/* PROMPT COMPLETAR TAREA (PUNTOS REALES Y DESVIACION) */}
      <Modal open={pointsPromptOpen} onOpenChange={setPointsPromptOpen}>
        <ModalContent className="max-w-sm">
          <ModalHeader>
            <ModalTitle>Completar Tarea</ModalTitle>
            <ModalDescription>
              Ingresa los puntos reales ocupados en esta tarea para auditar la desviación de KPIs.
            </ModalDescription>
          </ModalHeader>
          <div className="flex flex-col gap-4 py-4">
            {pointsPromptTask && (
              <div className="flex flex-col gap-3 p-3 rounded-lg border bg-muted/20 text-xs">
                <div>
                  <span className="font-semibold text-foreground">Tarea:</span> {pointsPromptTask.name}
                </div>
                <div>
                  <span className="font-semibold text-foreground">Puntos Estimados:</span> {pointsPromptTask.estimatedPoints} pts
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="actual-points-val">Puntos Reales</Label>
              <Input
                id="actual-points-val"
                type="number"
                min={0}
                required
                value={actualPointsVal}
                onChange={(e) => setActualPointsVal(Number(e.target.value))}
              />
            </div>
            {pointsPromptTask && actualPointsVal !== pointsPromptTask.estimatedPoints && (
              <div className="flex gap-2 items-center text-xs text-amber-600 font-medium">
                <AlertTriangle className="size-4" />
                <span>
                  Desviación: {actualPointsVal - pointsPromptTask.estimatedPoints > 0 ? '+' : ''}
                  {actualPointsVal - pointsPromptTask.estimatedPoints} puntos del estimado inicial.
                </span>
              </div>
            )}
          </div>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setPointsPromptOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCompleteWithPoints}>Completar y Registrar Puntos</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* MODAL REGISTRO DE TIEMPO / ACTIVIDAD */}
      <Modal open={timeLogModalOpen} onOpenChange={setTimeLogModalOpen}>
        <ModalContent className="max-w-md bg-card border border-border shadow-lg">
          <form onSubmit={handleTimeLogSubmit}>
            <ModalHeader>
              <ModalTitle>{timeLogType === 'start' ? 'Iniciar Actividad' : 'Finalizar Actividad'}</ModalTitle>
              <ModalDescription>
                {timeLogType === 'start'
                  ? 'Registra el inicio de tu tiempo de trabajo para esta tarea.'
                  : 'Registra el término del tiempo de trabajo para esta tarea.'}
              </ModalDescription>
            </ModalHeader>
            <div className="flex flex-col gap-4 py-4">
              {timeLogTask && (
                <div className="border rounded-lg p-3 bg-muted/20 text-xs flex flex-col gap-1">
                  <div><span className="font-semibold text-foreground">Tarea:</span> {timeLogTask.name}</div>
                  {timeLogType === 'finish' && timeLogTask.timeLogs && (
                    <div>
                      <span className="font-semibold text-foreground">Iniciada:</span>{' '}
                      {(() => {
                        const log = timeLogTask.timeLogs.find((l) => l.userId === profile?.id && l.endedAt === null);
                        return log ? new Date(log.startedAt).toLocaleString() : '—';
                      })()}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="time-log-note">Nota / Comentario (Opcional)</Label>
                <Textarea
                  id="time-log-note"
                  value={timeLogNote}
                  onChange={(e) => setTimeLogNote(e.target.value)}
                  className="min-h-20"
                  placeholder="Detalla qué actividad vas a realizar o qué avance lograste..."
                />
              </div>

              {timeLogType === 'finish' && timeLogTask && (
                <>
                  {(timeLogTask.dataSpec?.type === 'pdf_report' || timeLogTask.dataSpec?.type === 'file_generic') && (
                    <div className="flex flex-col gap-1.5 border-t pt-3 mt-2">
                      <Label htmlFor="deliverable-file" className="font-semibold text-xs text-foreground">
                        Subir Entregable / Producto ({timeLogTask.dataSpec?.label})
                      </Label>
                      <Input
                        id="deliverable-file"
                        type="file"
                        accept={timeLogTask.dataSpec?.type === 'pdf_report' ? '.pdf' : '*'}
                        onChange={(e) => setDeliverableFile(e.target.files?.[0] || null)}
                        className="bg-card text-xs border border-border"
                      />
                    </div>
                  )}

                  {timeLogTask.dataSpec?.type === 'custom_metrics' && (
                    <div className="flex flex-col gap-3 border-t pt-3 mt-2">
                      <Label className="font-semibold text-xs text-foreground">
                        Ingreso de Mediciones de Campo
                      </Label>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="metric-cota" className="text-[10px] text-muted-foreground">Cota espejo (m)</Label>
                          <Input
                            id="metric-cota"
                            placeholder="Ej. 2301.7"
                            type="number"
                            step="0.001"
                            value={metricCotaEspejo}
                            onChange={(e) => setMetricCotaEspejo(e.target.value)}
                            className="h-8 text-xs bg-card"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="metric-vol" className="text-[10px] text-muted-foreground">Volumen salmuera (m³)</Label>
                          <Input
                            id="metric-vol"
                            placeholder="Ej. 32000"
                            type="number"
                            value={metricVolSalmuera}
                            onChange={(e) => setMetricVolSalmuera(e.target.value)}
                            className="h-8 text-xs bg-card"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setTimeLogModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant={timeLogType === 'start' ? 'default' : 'destructive'}>
                {timeLogType === 'start' ? 'Iniciar Tiempo' : 'Finalizar Actividad'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={deleteTaskId !== null}
        onOpenChange={(open) => !open && setDeleteTaskId(null)}
        title="¿Eliminar tarea?"
        description="Esta acción eliminará de forma permanente la tarea seleccionada. ¿Deseas continuar?"
        onConfirm={async () => {
          if (deleteTaskId) {
            await handleDeleteTask(deleteTaskId);
          }
        }}
      />
    </div>
  );
}
