import { useState, type ReactNode, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useProjects } from '@/hooks/use-operations';
import { useProfile } from '@/hooks/use-profile';
import {
  Briefcase,
  Plus,
  Settings,
  FolderOpen,
  ArrowRight,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ProjectView } from '@/types/operations';

/** Lee un número de un objeto JSON sin tipar (KPIs); `undefined` si no aplica. */
function readNumber(rec: Record<string, unknown>, key: string): number | undefined {
  const v = rec[key];
  return typeof v === 'number' ? v : undefined;
}

/** Lee un string de un objeto JSON sin tipar (KPIs); `undefined` si no aplica. */
function readString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' ? v : undefined;
}

export function ProyectosTab(): ReactNode {
  const { profile } = useProfile();
  const { projects, loading, error, create, createSrv, updateKpis } = useProjects();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjId = searchParams.get('project');

  const selectedProject = useMemo(() => {
    if (!selectedProjId) return null;
    return projects.find((p) => p.id === selectedProjId) || null;
  }, [selectedProjId, projects]);

  const setSelectedProject = (proj: ProjectView | null) => {
    setSearchParams((prev) => {
      if (proj) {
        prev.set('project', proj.id);
      } else {
        prev.delete('project');
      }
      return prev;
    });
  };
  
  // Modals state
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [kpiModalOpen, setKpiModalOpen] = useState(false);

  // Form states
  const [projName, setProjName] = useState('');
  const [projCode, setProjCode] = useState('');
  const [projDept, setProjDept] = useState('dept-geo'); // Default GEO
  const [projClient, setProjClient] = useState('cli-als'); // Default ALS
  const [formError, setFormError] = useState<string | null>(null);

  const [srvName, setSrvName] = useState('');
  const [srvCode, setSrvCode] = useState('');
  const [srvRequiresClientSig, setSrvRequiresClientSig] = useState(false);

  const [kpiGoal, setKpiGoal] = useState<number>(100);
  const [kpiMetric, setKpiMetric] = useState('Puntos de Backlog');

  const isAdmin =
    profile?.roleKeys.includes('org_admin') ||
    profile?.roleKeys.includes('department_admin') ||
    profile?.roleKeys.includes('project_creator');

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!projName || !projCode) {
      setFormError('Por favor completa todos los campos requeridos.');
      return;
    }
    try {
      await create({
        name: projName,
        code: projCode.toUpperCase(),
        departmentId: projDept,
        clientId: projClient,
      });
      setProjectModalOpen(false);
      setProjName('');
      setProjCode('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear el proyecto.');
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedProject) return;
    if (!srvName || !srvCode) {
      setFormError('Por favor completa todos los campos requeridos.');
      return;
    }
    try {
      await createSrv(selectedProject.id, {
        name: srvName,
        code: srvCode.toUpperCase(),
        docCodingConfig: {
          requiresClientSignature: srvRequiresClientSig,
        },
      });
      setServiceModalOpen(false);
      setSrvName('');
      setSrvCode('');
      setSrvRequiresClientSig(false);
      // Actualizar proyecto seleccionado
      setSelectedProject(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear el servicio.');
    }
  };

  const handleUpdateKpis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    try {
      await updateKpis(selectedProject.id, {
        goal: kpiGoal,
        metric: kpiMetric,
      });
      setKpiModalOpen(false);
      setSelectedProject(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar los KPIs.');
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-48 animate-pulse rounded-lg bg-muted/40 border border-border" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="flex gap-2 items-center">
          <AlertCircle className="size-4" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Botonera superior */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">
          {selectedProject ? `Proyecto: ${selectedProject.name}` : 'Catálogo de Proyectos'}
        </h2>
        <div className="flex gap-2">
          {selectedProject && (
            <Button variant="outline" onClick={() => setSelectedProject(null)}>
              Volver a la lista
            </Button>
          )}
          {isAdmin && !selectedProject && (
            <Button onClick={() => setProjectModalOpen(true)}>
              <Plus className="size-4 mr-2" />
              Nuevo Proyecto
            </Button>
          )}
        </div>
      </div>

      {/* DETALLE O LISTADO */}
      {selectedProject ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Info y Servicios */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{selectedProject.name}</CardTitle>
                  <Badge variant="outline">{selectedProject.code}</Badge>
                </div>
                <CardDescription>
                  Departamento: {selectedProject.department?.name || 'GEO'} | Cliente: {selectedProject.client?.name || 'ALS'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex justify-between items-center border-b pb-4">
                  <h3 className="font-semibold text-sm">Servicios Asociados</h3>
                  {isAdmin && (
                    <Button size="sm" onClick={() => setServiceModalOpen(true)}>
                      <Plus className="size-3 mr-1" />
                      Agregar Servicio
                    </Button>
                  )}
                </div>
                {selectedProject.services && selectedProject.services.length > 0 ? (
                  <div className="grid gap-3">
                    {selectedProject.services.map((srv) => (
                      <div
                        key={srv.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card/50 text-sm"
                      >
                        <div>
                          <p className="font-medium text-foreground">{srv.name}</p>
                          <p className="text-xs text-muted-foreground">Código: {srv.code}</p>
                        </div>
                        <Badge variant={srv.docCodingConfig?.requiresClientSignature ? 'secondary' : 'outline'}>
                          {srv.docCodingConfig?.requiresClientSignature
                            ? 'Firma Cliente Requerida'
                            : 'Firma QA Solamente'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No hay servicios registrados en este proyecto.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* KPIs */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-md">KPI & Objetivos</CardTitle>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={() => {
                      const goal = readNumber(selectedProject.kpis, 'goal') ?? 100;
                      const metric = readString(selectedProject.kpis, 'metric') ?? 'Puntos de Backlog';
                      setKpiGoal(goal);
                      setKpiMetric(metric);
                      setKpiModalOpen(true);
                    }}>
                      <Settings className="size-4 text-muted-foreground hover:text-foreground" />
                    </Button>
                  )}
                </div>
                <CardDescription>
                  Configura y visualiza el progreso del aporte de tareas.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/10">
                  <TrendingUp className="size-8 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Meta del Proyecto</p>
                    <p className="text-lg font-bold text-foreground">
                      {readNumber(selectedProject.kpis, 'goal') ?? 100} {readString(selectedProject.kpis, 'metric') ?? 'Pts'}
                    </p>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground mt-2">
                  <p>Cada tarea marcada como **Completada** suma sus puntos en tiempo real para visualizar el rendimiento acumulado frente a la meta.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        /* LISTADO DE PROYECTOS */
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((proj) => (
            <Card
              key={proj.id}
              className="hover:border-primary/30 transition-all cursor-pointer bg-card/60 hover:shadow-xs"
              onClick={() => setSelectedProject(proj)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Briefcase className="size-4 text-primary shrink-0" />
                    <CardTitle className="text-md line-clamp-1">{proj.name}</CardTitle>
                  </div>
                  <Badge variant="outline">{proj.code}</Badge>
                </div>
                <CardDescription className="text-xs line-clamp-1">
                  Cliente: {proj.client?.name || 'ALS'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex justify-between items-center text-xs text-muted-foreground border-t pt-3">
                  <span>Depto: {proj.department?.name || 'GEO'}</span>
                  <span>{proj.services?.length || 0} Servicios</span>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end pt-0 pb-3">
                <span className="text-xs text-primary font-medium inline-flex items-center gap-1">
                  Ver detalle
                  <ArrowRight className="size-3" />
                </span>
              </CardFooter>
            </Card>
          ))}
          {projects.length === 0 && (
            <div className="col-span-full py-12 text-center rounded-lg border border-dashed border-border bg-card/30">
              <FolderOpen className="size-10 text-muted-foreground/60 mx-auto mb-3" />
              <h3 className="font-semibold text-lg">No hay proyectos</h3>
              <p className="text-sm text-muted-foreground">No tienes proyectos asignados en tu scope actual.</p>
            </div>
          )}
        </div>
      )}

      {/* DIALOG CREAR PROYECTO */}
      {projectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleCreateProject}>
              <CardHeader>
                <CardTitle>Crear Proyecto</CardTitle>
                <CardDescription>Registra un nuevo proyecto en la organización.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {formError && (
                  <div className="p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive">
                    {formError}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="proj-name">Nombre del Proyecto</Label>
                  <Input
                    id="proj-name"
                    required
                    value={projName}
                    onChange={(e) => setProjName(e.target.value)}
                    placeholder="Ej. Geofísica Minera El Teniente"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="proj-code">Código (3-4 Chars)</Label>
                    <Input
                      id="proj-code"
                      required
                      maxLength={4}
                      value={projCode}
                      onChange={(e) => setProjCode(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                      placeholder="Ej. GEO"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="proj-dept">Departamento</Label>
                    <select
                      id="proj-dept"
                      value={projDept}
                      onChange={(e) => setProjDept(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="dept-geo">Geofísica (GEO)</option>
                      <option value="dept-ing">Ingeniería (ING)</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="proj-client">Cliente Mandante</Label>
                  <select
                    id="proj-client"
                    value={projClient}
                    onChange={(e) => setProjClient(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="cli-als">Alamos Gold (ALS)</option>
                    <option value="cli-anto">Antofagasta Minerals (ANTO)</option>
                  </select>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setProjectModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">Crear</Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* DIALOG AGREGAR SERVICIO */}
      {serviceModalOpen && selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleCreateService}>
              <CardHeader>
                <CardTitle>Agregar Servicio</CardTitle>
                <CardDescription>Crea un servicio en {selectedProject.name}.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {formError && (
                  <div className="p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive">
                    {formError}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="srv-name">Nombre del Servicio</Label>
                  <Input
                    id="srv-name"
                    required
                    value={srvName}
                    onChange={(e) => setSrvName(e.target.value)}
                    placeholder="Ej. Mapeo Sísmico de Estructuras"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="srv-code">Código del Servicio (3 Chars)</Label>
                  <Input
                    id="srv-code"
                    required
                    maxLength={3}
                    value={srvCode}
                    onChange={(e) => setSrvCode(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                    placeholder="Ej. MAP"
                  />
                </div>
                <div className="flex items-center gap-2 border p-3 rounded-lg text-sm bg-muted/20 mt-1">
                  <input
                    id="srv-sig"
                    type="checkbox"
                    checked={srvRequiresClientSig}
                    onChange={(e) => setSrvRequiresClientSig(e.target.checked)}
                    className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <Label htmlFor="srv-sig" className="cursor-pointer font-normal">
                    ¿Requiere firma de aprobación del Cliente/ITO para documentos?
                  </Label>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setServiceModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">Agregar</Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* DIALOG CONFIG KPIs */}
      {kpiModalOpen && selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleUpdateKpis}>
              <CardHeader>
                <CardTitle>Configurar KPIs</CardTitle>
                <CardDescription>Define metas de desempeño.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="kpi-goal">Meta Numérica</Label>
                  <Input
                    id="kpi-goal"
                    type="number"
                    required
                    min={1}
                    value={kpiGoal}
                    onChange={(e) => setKpiGoal(parseInt(e.target.value, 10))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="kpi-metric">Métrica / Unidad</Label>
                  <Input
                    id="kpi-metric"
                    required
                    value={kpiMetric}
                    onChange={(e) => setKpiMetric(e.target.value)}
                    placeholder="Ej. Puntos de Backlog, Tareas, etc."
                  />
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setKpiModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">Guardar</Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
