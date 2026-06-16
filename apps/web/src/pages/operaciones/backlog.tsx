import { useState, type ReactNode, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import { useProjects, useTasks } from '@/hooks/use-operations';
import { useUsers } from '@/hooks/use-users';
import {
  Plus,
  Search,
  Filter,
  HelpCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Trash2,
  User,
  Edit2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from '@/components/ui/modal';
import type { TaskView, TaskStatus } from '@/types/operations';

export function BacklogTab(): ReactNode {
  const { projects } = useProjects();
  const { users } = useUsers();
  
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

  const { tasks, loading, create, updateStatus, update, remove } = useTasks(taskFilters);

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
  const [formError, setFormError] = useState<string | null>(null);

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
      await create({
        name: taskName,
        description: taskDesc.trim() || undefined,
        projectId: taskProjId,
        serviceId: taskSrvId || undefined,
        assignedToId: taskAssignedId || undefined,
        estimatedPoints: Number(taskEstPoints),
        recurrence: taskRecurrence.trim() || undefined,
        clientUserId: taskClientId || undefined,
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

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case 'PENDIENTE':
        return 'bg-amber-500/10 border-amber-500/20 text-amber-500';
      case 'EN_PROGRESO':
        return 'bg-blue-500/10 border-blue-500/20 text-blue-500';
      case 'REVISADO':
        return 'bg-purple-500/10 border-purple-500/20 text-purple-500';
      case 'COMPLETADO':
        return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500';
    }
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
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-2" />
            Nueva Tarea
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-proj" className="text-xs">Proyecto</Label>
            <select
              id="filter-proj"
              value={filterProject}
              onChange={(e) => {
                setFilterProject(e.target.value);
                setFilterService('all'); // reset service on project change
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">Todos los proyectos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-srv" className="text-xs">Servicio</Label>
            <select
              id="filter-srv"
              value={filterService}
              disabled={filterProject === 'all'}
              onChange={(e) => setFilterService(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              <option value="all">Todos los servicios</option>
              {filterProjectServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-user" className="text-xs">Responsable</Label>
            <select
              id="filter-user"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">Todos los responsables</option>
              <option value="unassigned">Sin Asignar</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-search" className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                id="filter-search"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Buscar por nombre..."
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tablero Kanban */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-96 animate-pulse rounded-xl bg-muted/40 border border-border" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          {(Object.keys(columns) as TaskStatus[]).map((status) => {
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
                      {status}
                    </span>
                    <Badge className={getStatusColor(status)}>
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

                          {/* Quick Actions */}
                          <div className="flex justify-between items-center w-full">
                            <div className="flex gap-1.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-muted-foreground hover:text-foreground"
                                onClick={() => handleOpenEdit(t)}
                                title="Editar"
                              >
                                <Edit2 className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTaskId(t.id)}
                                title="Eliminar"
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </div>

                            {/* Transition buttons */}
                            <div className="flex gap-1">
                              {status !== 'PENDIENTE' && (
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
                              {status !== 'COMPLETADO' && (
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
                    <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-dashed border-border bg-card/10">
                      <HelpCircle className="size-6 text-muted-foreground/40 mb-1" />
                      <span className="text-xs text-muted-foreground font-medium">Sin tareas</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL CREAR TAREA */}
      <Modal open={createOpen} onOpenChange={setCreateOpen}>
        <ModalContent className="max-w-md">
          <form onSubmit={handleCreateTask}>
            <ModalHeader>
              <ModalTitle>Nueva Tarea de Backlog</ModalTitle>
              <ModalDescription>Crea un ítem de backlog y asígnale estimaciones.</ModalDescription>
            </ModalHeader>
            <div className="flex flex-col gap-4 py-4">
              {formError && (
                <div className="p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive font-medium">
                  {formError}
                </div>
              )}
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
                <textarea
                  id="task-desc"
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Detalles sobre lo que se espera..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="task-proj">Proyecto</Label>
                  <select
                    id="task-proj"
                    required
                    value={taskProjId}
                    onChange={(e) => {
                      setTaskProjId(e.target.value);
                      setTaskSrvId(''); // reset service
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Selecciona proyecto</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="task-srv">Servicio (Opcional)</Label>
                  <select
                    id="task-srv"
                    value={taskSrvId}
                    disabled={!taskProjId}
                    onChange={(e) => setTaskSrvId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <option value="">Ninguno</option>
                    {projectServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="task-assigned">Responsable</Label>
                  <select
                    id="task-assigned"
                    value={taskAssignedId}
                    onChange={(e) => setTaskAssignedId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Sin Asignar</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </select>
                </div>

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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="task-client">Mandante/ITO Solicita</Label>
                  <select
                    id="task-client"
                    value={taskClientId}
                    onChange={(e) => setTaskClientId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Ninguno</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </select>
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
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">Crear Tarea</Button>
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
                  <textarea
                    id="edit-desc"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-assigned">Responsable</Label>
                    <select
                      id="edit-assigned"
                      value={editAssignedId}
                      onChange={(e) => setEditAssignedId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">Sin Asignar</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName}
                        </option>
                      ))}
                    </select>
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
                  <select
                    id="edit-client"
                    value={editClientId}
                    onChange={(e) => setEditClientId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Ninguno</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </select>
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
