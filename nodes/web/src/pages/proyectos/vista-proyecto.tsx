import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Briefcase,
  CalendarClock,
  ChevronRight,
  FileText,
  FolderGit2,
  Layers,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { PageContainer } from '@/components/layout/page-container';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { useProject, useAssignments } from '@/hooks/use-project-hierarchy';
import { useHasRole } from '@/hooks/use-has-role';
import { roleLabel } from '@/lib/role-labels';
import {
  errorToMessage,
  listUsers,
  listMetricPhases,
  createMetricPhase,
  setPhaseDataSpec,
  setServiceFrequency,
  type MetricPhase,
  type MetricVariable,
  type UserListItem,
} from '@/lib/api';
import type { ProjectView, ServiceView } from '@/types/operations';
import type {
  ProjectType,
  ServiceFrequency,
  VariableType,
  ProjectWorkerStatus,
  PhaseVariableSpecInput,
} from '@/types/projects';

/* ==========================================================================
   Constantes de presentación
   ========================================================================== */

/** Roles que pueden gestionar el equipo del proyecto (gate demo del tab Trabajadores). */
const TEAM_MANAGER_ROLES = ['org_admin', 'department_admin', 'project_creator'];

/** Roles asignables a un trabajador dentro del proyecto (selector del diálogo). */
const ASSIGNABLE_ROLE_KEYS: string[] = [
  'project_creator',
  'operator',
  'qa',
  'finance',
  'viewer',
  'client_ito',
  'supervisor',
  'ito',
  'adm_contrato',
];

/** Primer rol asignable, usado como valor por defecto del selector. */
const DEFAULT_ROLE_KEY = ASSIGNABLE_ROLE_KEYS[0] ?? 'operator';

/** Tipos de variable del editor de datos esperados (Select del DataSpec). */
const VARIABLE_TYPES: { value: VariableType; label: string }[] = [
  { value: 'IMAGEN', label: 'Imagen' },
  { value: 'PLANO', label: 'Plano' },
  { value: 'POLIGONO', label: 'Polígono' },
  { value: 'ORTOFOTO', label: 'Ortofoto' },
  { value: 'PDF', label: 'PDF' },
  { value: 'GEODATA', label: 'Geodata' },
  { value: 'ENTERO', label: 'Entero' },
  { value: 'DECIMAL', label: 'Decimal' },
  { value: 'BOOLEAN', label: 'Booleano' },
  { value: 'METROS', label: 'Metros' },
  { value: 'M3', label: 'Metros cúbicos (m³)' },
  { value: 'TEXTO', label: 'Texto' },
  { value: 'OTRO', label: 'Otro' },
];

/** Frecuencias de un servicio RUTINARIO (Select del panel de servicios). */
const SERVICE_FREQUENCIES: { value: ServiceFrequency; label: string }[] = [
  { value: 'DIARIA', label: 'Diaria' },
  { value: 'SEMANAL', label: 'Semanal' },
  { value: 'QUINCENAL', label: 'Quincenal' },
  { value: 'MENSUAL', label: 'Mensual' },
  { value: 'A_DEMANDA', label: 'A demanda' },
];

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  SPOT: 'SPOT',
  OBRAS_CIVILES: 'Obras civiles',
  RUTINARIO: 'Rutinario',
};

/**
 * El detalle `GET /projects/:id` incluye los escalares A0 (`projectType`,
 * `faenaId`, `contractNumber`) que aún no están declarados en {@link ProjectView}
 * (tipo legacy de operaciones). Los leemos de forma defensiva con esta vista
 * ampliada sin castear a `any`.
 */
type ProjectDetail = ProjectView & {
  projectType?: ProjectType | null;
  faenaId?: string | null;
  contractNumber?: string | null;
  frequency?: ServiceFrequency | null;
};

type ServiceWithFrequency = ServiceView & { frequency?: ServiceFrequency | null };

/** Fila editable del editor de DataSpec (con id local para el keying de React). */
interface VariableRow extends PhaseVariableSpecInput {
  _key: string;
}

function newVariableRow(): VariableRow {
  return {
    _key: crypto.randomUUID(),
    code: '',
    name: '',
    type: 'TEXTO',
    unit: '',
    description: '',
    required: false,
  };
}

/* ==========================================================================
   Página Capa 4 — Vista de proyecto
   ========================================================================== */

type TabKey = 'trabajadores' | 'documentacion' | 'fases';

export default function VistaProyectoPage(): ReactNode {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, loading, error, refetch } = useProject(projectId);

  const canManageTeam = useHasRole(TEAM_MANAGER_ROLES);

  const detail = project as ProjectDetail | null;
  const projectType = detail?.projectType ?? null;
  // RUTINARIO → panel "Servicios" (con frecuencia); SPOT/OBRAS_CIVILES → "Fases".
  const isRoutine = projectType === 'RUTINARIO';

  // El tab Trabajadores solo es visible con rol; si no, arrancamos en Documentación.
  const [tab, setTab] = useState<TabKey>('documentacion');
  useEffect(() => {
    if (canManageTeam) setTab('trabajadores');
  }, [canManageTeam]);

  const backToFaena =
    detail?.faenaId && detail?.clientId
      ? `/proyectos/cliente/${detail.clientId}/faena/${detail.faenaId}`
      : detail?.clientId
        ? `/proyectos/cliente/${detail.clientId}`
        : '/proyectos';

  if (loading) {
    return (
      <PageContainer maxWidth="6xl">
        <LoadingState rows={6} label="Cargando el proyecto…" />
      </PageContainer>
    );
  }

  if (error || !project) {
    return (
      <PageContainer maxWidth="6xl">
        <ErrorState message={error ?? 'No se encontró el proyecto.'} />
        <div>
          <Link to="/proyectos" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft className="mr-2 size-4" />
            Volver a proyectos
          </Link>
        </div>
      </PageContainer>
    );
  }

  const allTabItems: TabItem<TabKey>[] = [
    { value: 'trabajadores', label: 'Trabajadores', icon: Users },
    { value: 'documentacion', label: 'Documentación', icon: FileText },
    {
      value: 'fases',
      label: isRoutine ? 'Servicios' : 'Fases',
      icon: isRoutine ? CalendarClock : Layers,
    },
  ];
  const tabItems = allTabItems.filter(
    (t) => t.value !== 'trabajadores' || canManageTeam,
  );

  return (
    <PageContainer maxWidth="6xl">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label="Ruta">
        <Link to="/proyectos" className="hover:text-foreground">
          Proyectos
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link to={backToFaena} className="hover:text-foreground">
          {detail?.client?.name ? `Faena de ${detail.client.name}` : 'Faena'}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground">{project.name}</span>
      </nav>

      {/* Cabecera */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FolderGit2 className="size-5" />
              </div>
              <div>
                <CardTitle className="text-2xl">{project.name}</CardTitle>
                <CardDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="size-3.5" />
                    {detail?.client?.name ?? 'Cliente'}
                  </span>
                  {detail?.department?.name && <span>· {detail.department.name}</span>}
                </CardDescription>
              </div>
            </div>
            <Link
              to={backToFaena}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ArrowLeft className="mr-2 size-4" />
              Volver a la faena
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Código</dt>
              <dd className="mt-0.5 font-mono font-medium">{project.code}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tipo</dt>
              <dd className="mt-0.5">
                {projectType ? (
                  <Badge variant="secondary">{PROJECT_TYPE_LABELS[projectType]}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">N° de contrato</dt>
              <dd className="mt-0.5 font-medium">{detail?.contractNumber || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Servicios</dt>
              <dd className="mt-0.5 font-medium">{project.services?.length ?? 0}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs
        items={tabItems}
        value={tab}
        onValueChange={setTab}
        aria-label="Secciones del proyecto"
      />

      {/* Contenido del tab */}
      {tab === 'trabajadores' && canManageTeam && (
        <TrabajadoresTab projectId={project.id} />
      )}
      {tab === 'documentacion' && <DocumentacionTab />}
      {tab === 'fases' && (
        <FasesTab
          projectId={project.id}
          services={(project.services ?? []) as ServiceWithFrequency[]}
          isRoutine={isRoutine}
          canManage={canManageTeam}
          onServiceChanged={refetch}
        />
      )}
    </PageContainer>
  );
}

/* ==========================================================================
   Tab 1 — Trabajadores (assignments)
   ========================================================================== */

const STATUS_LABELS: Record<ProjectWorkerStatus, string> = {
  ACTIVO: 'Activo',
  INACTIVO: 'Inactivo',
};

function TrabajadoresTab({ projectId }: { projectId: string }): ReactNode {
  const { assignments, loading, error, create, update, remove } = useAssignments(projectId);

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formUserId, setFormUserId] = useState('');
  const [formRole, setFormRole] = useState(DEFAULT_ROLE_KEY);
  const [formStatus, setFormStatus] = useState<ProjectWorkerStatus>('ACTIVO');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listUsers()
      .then((list) => {
        if (alive) setUsers(list);
      })
      .catch(() => {
        // Silencioso: el picker cae a "sin usuarios" y el diálogo lo informa.
      });
    return () => {
      alive = false;
    };
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setFormUserId('');
    setFormRole(DEFAULT_ROLE_KEY);
    setFormStatus('ACTIVO');
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (assignmentId: string, roleKey: string, status: ProjectWorkerStatus) => {
    setEditingId(assignmentId);
    setFormRole(roleKey);
    setFormStatus(status);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!editingId && !formUserId) {
      setFormError('Selecciona un usuario.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await update(editingId, { roleKey: formRole, status: formStatus });
        toast.success('Asignación actualizada.');
      } else {
        await create({ userId: formUserId, roleKey: formRole, status: formStatus });
        toast.success('Trabajador asignado.');
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(errorToMessage(err, 'No se pudo guardar la asignación.'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (assignmentId: string) => {
    setRemovingId(assignmentId);
    try {
      await remove(assignmentId);
      toast.success('Trabajador removido del proyecto.');
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo remover al trabajador.'));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Equipo del proyecto</CardTitle>
            <CardDescription>Trabajadores asignados y su rol en el proyecto.</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 size-4" />
            Agregar trabajador
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState rows={3} label="Cargando el equipo…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Sin trabajadores asignados"
            message="Agrega trabajadores para conformar el equipo de este proyecto."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {assignments.map((a) => {
              const name = a.user
                ? `${a.user.firstName} ${a.user.lastName}`.trim()
                : a.userId;
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.user?.email ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{roleLabel(a.roleKey)}</Badge>
                    <Badge variant={a.status === 'ACTIVO' ? 'secondary' : 'outline'}>
                      {STATUS_LABELS[a.status]}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar asignación"
                      onClick={() => openEdit(a.id, a.roleKey, a.status)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover trabajador"
                      disabled={removingId === a.id}
                      onClick={() => handleRemove(a.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {/* Diálogo agregar/editar */}
      <Modal open={dialogOpen} onOpenChange={setDialogOpen}>
        <ModalContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>{editingId ? 'Editar asignación' : 'Agregar trabajador'}</ModalTitle>
              <ModalDescription>
                {editingId
                  ? 'Actualiza el rol o el estado del trabajador en el proyecto.'
                  : 'Selecciona un usuario y su rol dentro del proyecto.'}
              </ModalDescription>
            </ModalHeader>

            {formError && (
              <Alert variant="destructive" live>
                {formError}
              </Alert>
            )}

            {!editingId && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assign-user">Usuario</Label>
                <Select
                  id="assign-user"
                  aria-label="Usuario a asignar"
                  value={formUserId}
                  onChange={(e) => setFormUserId(e.target.value)}
                >
                  <option value="">Selecciona un usuario…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} ({u.email})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assign-role">Rol</Label>
                <Select
                  id="assign-role"
                  aria-label="Rol del trabajador"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                >
                  {ASSIGNABLE_ROLE_KEYS.map((rk) => (
                    <option key={rk} value={rk}>
                      {roleLabel(rk)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assign-status">Estado</Label>
                <Select
                  id="assign-status"
                  aria-label="Estado del trabajador"
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as ProjectWorkerStatus)}
                >
                  <option value="ACTIVO">Activo</option>
                  <option value="INACTIVO">Inactivo</option>
                </Select>
              </div>
            </div>

            <ModalFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : editingId ? 'Guardar' : 'Agregar'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </Card>
  );
}

/* ==========================================================================
   Tab 2 — Documentación (secciones reales, sin contenido aún)
   ========================================================================== */

const DOC_SECTIONS = [
  {
    key: 'bases',
    title: 'Bases técnicas',
    description: 'Especificaciones y requisitos técnicos del contrato.',
  },
  {
    key: 'procedimientos',
    title: 'Procedimientos',
    description: 'Protocolos y procedimientos operativos del proyecto.',
  },
  {
    key: 'contratos',
    title: 'Contratos',
    description: 'Documentos contractuales y anexos.',
  },
  { key: 'otros', title: 'Otros', description: 'Documentación complementaria.' },
];

function DocumentacionTab(): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {DOC_SECTIONS.map((s) => (
        <Card key={s.key}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <CardTitle className="text-base">{s.title}</CardTitle>
            </div>
            <CardDescription>{s.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState icon={FileText} message="Sin documentos" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ==========================================================================
   Tab 3 — Fases / Servicios (según projectType) con editor de DataSpec
   ========================================================================== */

function FasesTab({
  projectId,
  services,
  isRoutine,
  canManage,
  onServiceChanged,
}: {
  projectId: string;
  services: ServiceWithFrequency[];
  isRoutine: boolean;
  canManage: boolean;
  onServiceChanged: () => Promise<void> | void;
}): ReactNode {
  if (services.length === 0) {
    return (
      <EmptyState
        icon={isRoutine ? CalendarClock : Layers}
        title="Sin servicios en el proyecto"
        message={
          isRoutine
            ? 'Este proyecto no tiene servicios rutinarios definidos todavía.'
            : 'Crea un servicio en el proyecto (Operaciones) para poder añadir fases.'
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {services.map((srv) => (
        <ServiceBlock
          key={srv.id}
          projectId={projectId}
          service={srv}
          isRoutine={isRoutine}
          canManage={canManage}
          onServiceChanged={onServiceChanged}
        />
      ))}
    </div>
  );
}

function ServiceBlock({
  projectId,
  service,
  isRoutine,
  canManage,
  onServiceChanged,
}: {
  projectId: string;
  service: ServiceWithFrequency;
  isRoutine: boolean;
  canManage: boolean;
  onServiceChanged: () => Promise<void> | void;
}): ReactNode {
  const [phases, setPhases] = useState<MetricPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadPhases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMetricPhases(service.id);
      if (mountedRef.current) setPhases(list);
    } catch (err) {
      if (mountedRef.current) setError(errorToMessage(err, 'No se pudieron cargar las fases.'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [service.id]);

  useEffect(() => {
    void loadPhases();
  }, [loadPhases]);

  // Frecuencia (solo RUTINARIO)
  const [frequency, setFrequency] = useState<ServiceFrequency>(service.frequency ?? 'A_DEMANDA');
  const [savingFreq, setSavingFreq] = useState(false);

  const handleSaveFrequency = async (value: ServiceFrequency) => {
    const previous = frequency;
    setFrequency(value);
    setSavingFreq(true);
    try {
      await setServiceFrequency(projectId, service.id, { frequency: value });
      toast.success('Frecuencia actualizada.');
      await onServiceChanged();
    } catch (err) {
      setFrequency(previous); // revertir el optimismo si el PUT falla
      toast.error(errorToMessage(err, 'No se pudo actualizar la frecuencia.'));
    } finally {
      setSavingFreq(false);
    }
  };

  // Crear fase
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [phaseCode, setPhaseCode] = useState('');
  const [phaseName, setPhaseName] = useState('');
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [creatingPhase, setCreatingPhase] = useState(false);

  const handleCreatePhase = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhaseError(null);
    if (!phaseCode.trim() || !phaseName.trim()) {
      setPhaseError('Completa el código y el nombre de la fase.');
      return;
    }
    setCreatingPhase(true);
    try {
      await createMetricPhase({
        code: phaseCode.trim().toUpperCase(),
        name: phaseName.trim(),
        serviceId: service.id,
      });
      toast.success('Fase creada.');
      setPhaseDialogOpen(false);
      setPhaseCode('');
      setPhaseName('');
      await loadPhases();
    } catch (err) {
      setPhaseError(errorToMessage(err, 'No se pudo crear la fase.'));
    } finally {
      setCreatingPhase(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{service.name}</CardTitle>
              <Badge variant="outline" className="font-mono">
                {service.code}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              {isRoutine ? 'Servicio rutinario' : 'Servicio · fases y datos esperados'}
            </CardDescription>
          </div>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setPhaseDialogOpen(true)}>
              <Plus className="mr-1 size-4" />
              {isRoutine ? 'Nueva rutina' : 'Nueva fase'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isRoutine && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <Label htmlFor={`freq-${service.id}`} className="text-sm">
              Frecuencia
            </Label>
            <Select
              id={`freq-${service.id}`}
              aria-label="Frecuencia del servicio"
              value={frequency}
              disabled={!canManage || savingFreq}
              onChange={(e) => handleSaveFrequency(e.target.value as ServiceFrequency)}
              className="w-auto"
            >
              {SERVICE_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        {loading ? (
          <LoadingState rows={2} label="Cargando fases…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadPhases()} />
        ) : phases.length === 0 ? (
          <EmptyState
            message={
              isRoutine
                ? 'Sin rutinas definidas. Crea una para configurar los datos esperados.'
                : 'Sin fases. Crea una fase para configurar sus datos esperados.'
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {phases.map((phase) => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                canManage={canManage}
                onSaved={loadPhases}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Diálogo crear fase */}
      <Modal open={phaseDialogOpen} onOpenChange={setPhaseDialogOpen}>
        <ModalContent>
          <form onSubmit={handleCreatePhase} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>{isRoutine ? 'Nueva rutina' : 'Nueva fase'}</ModalTitle>
              <ModalDescription>
                En el servicio <span className="font-medium">{service.name}</span>.
              </ModalDescription>
            </ModalHeader>

            {phaseError && (
              <Alert variant="destructive" live>
                {phaseError}
              </Alert>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`phase-code-${service.id}`}>Código</Label>
                <Input
                  id={`phase-code-${service.id}`}
                  value={phaseCode}
                  maxLength={8}
                  onChange={(e) => setPhaseCode(e.target.value)}
                  placeholder="F1"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor={`phase-name-${service.id}`}>Nombre</Label>
                <Input
                  id={`phase-name-${service.id}`}
                  value={phaseName}
                  onChange={(e) => setPhaseName(e.target.value)}
                  placeholder="Ej. Levantamiento topográfico"
                />
              </div>
            </div>

            <ModalFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPhaseDialogOpen(false)}
                disabled={creatingPhase}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={creatingPhase}>
                {creatingPhase ? 'Creando…' : 'Crear'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </Card>
  );
}

/* --- Fila de fase con editor de datos esperados (DataSpec) --- */

function variableTypeLabel(type: string): string {
  return VARIABLE_TYPES.find((t) => t.value === type)?.label ?? type;
}

function toRows(variables: MetricVariable[] | undefined): VariableRow[] {
  if (!variables || variables.length === 0) return [];
  return variables.map((v) => ({
    _key: v.id,
    code: v.code,
    name: v.name,
    type: v.type as VariableType,
    unit: v.unit ?? '',
    description: '',
    required: false,
  }));
}

function PhaseRow({
  phase,
  canManage,
  onSaved,
}: {
  phase: MetricPhase;
  canManage: boolean;
  onSaved: () => Promise<void> | void;
}): ReactNode {
  const [editorOpen, setEditorOpen] = useState(false);
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(phase.variables));
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const variableCount = phase.variables?.length ?? 0;

  const openEditor = () => {
    const initial = toRows(phase.variables);
    setRows(initial.length > 0 ? initial : [newVariableRow()]);
    setEditorError(null);
    setEditorOpen(true);
  };

  const updateRow = (key: string, patch: Partial<VariableRow>) => {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r._key !== key));
  };

  const addRow = () => setRows((prev) => [...prev, newVariableRow()]);

  const handleSave = async () => {
    setEditorError(null);
    const cleaned = rows
      .map((r) => ({ ...r, code: r.code.trim(), name: r.name.trim() }))
      .filter((r) => r.code || r.name);

    for (const r of cleaned) {
      if (!r.code || !r.name) {
        setEditorError('Cada variable necesita código y nombre.');
        return;
      }
    }
    const codes = cleaned.map((r) => r.code);
    if (new Set(codes).size !== codes.length) {
      setEditorError('Hay códigos de variable duplicados.');
      return;
    }

    setSaving(true);
    try {
      await setPhaseDataSpec(phase.id, {
        variables: cleaned.map<PhaseVariableSpecInput>((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          unit: r.unit?.trim() || undefined,
          description: r.description?.trim() || undefined,
          required: r.required,
        })),
      });
      toast.success('Datos esperados guardados.');
      setEditorOpen(false);
      await onSaved();
    } catch (err) {
      setEditorError(errorToMessage(err, 'No se pudieron guardar los datos esperados.'));
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(
    () => (phase.variables ?? []).map((v) => v.code).join(', '),
    [phase.variables],
  );

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {phase.code}
            </Badge>
            <span className="truncate font-medium">{phase.name}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {variableCount > 0
              ? `${variableCount} variable(s): ${summary}`
              : 'Sin datos esperados definidos.'}
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={openEditor}>
            <ListChecks className="mr-1 size-4" />
            Datos esperados
          </Button>
        )}
      </div>

      {/* Vista rápida de variables definidas */}
      {variableCount > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(phase.variables ?? []).map((v) => (
            <Badge key={v.id} variant="secondary" className="font-normal">
              {v.name}
              <span className="ml-1 text-muted-foreground">
                · {variableTypeLabel(v.type)}
                {v.unit ? ` (${v.unit})` : ''}
              </span>
            </Badge>
          ))}
        </div>
      )}

      {/* Editor de DataSpec */}
      <Modal open={editorOpen} onOpenChange={setEditorOpen}>
        <ModalContent className="sm:max-w-3xl">
          <div className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>Datos esperados: {phase.name}</ModalTitle>
              <ModalDescription>
                Define las variables tipadas que se capturarán en esta fase. Se reemplaza el spec
                completo al guardar.
              </ModalDescription>
            </ModalHeader>

            {editorError && (
              <Alert variant="destructive" live>
                {editorError}
              </Alert>
            )}

            <div className="flex flex-col gap-3">
              {rows.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  Sin variables. Agrega la primera.
                </p>
              )}
              {rows.map((row) => (
                <div
                  key={row._key}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-12"
                >
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <Label className="text-xs" htmlFor={`code-${row._key}`}>
                      Código
                    </Label>
                    <Input
                      id={`code-${row._key}`}
                      value={row.code}
                      onChange={(e) => updateRow(row._key, { code: e.target.value })}
                      placeholder="AREA"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-3">
                    <Label className="text-xs" htmlFor={`name-${row._key}`}>
                      Nombre
                    </Label>
                    <Input
                      id={`name-${row._key}`}
                      value={row.name}
                      onChange={(e) => updateRow(row._key, { name: e.target.value })}
                      placeholder="Área medida"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-3">
                    <Label className="text-xs" htmlFor={`type-${row._key}`}>
                      Tipo
                    </Label>
                    <Select
                      id={`type-${row._key}`}
                      aria-label="Tipo de variable"
                      value={row.type}
                      onChange={(e) =>
                        updateRow(row._key, { type: e.target.value as VariableType })
                      }
                    >
                      {VARIABLE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <Label className="text-xs" htmlFor={`unit-${row._key}`}>
                      Unidad
                    </Label>
                    <Input
                      id={`unit-${row._key}`}
                      value={row.unit ?? ''}
                      onChange={(e) => updateRow(row._key, { unit: e.target.value })}
                      placeholder="m²"
                    />
                  </div>
                  <div className="flex items-end justify-between gap-2 sm:col-span-2">
                    <Label className="flex cursor-pointer items-center gap-1.5 text-xs font-normal">
                      <input
                        type="checkbox"
                        checked={row.required ?? false}
                        onChange={(e) => updateRow(row._key, { required: e.target.checked })}
                        className="size-4 rounded border-input text-primary focus:ring-primary"
                      />
                      Requerida
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Quitar variable"
                      onClick={() => removeRow(row._key)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-12">
                    <Label className="text-xs" htmlFor={`desc-${row._key}`}>
                      Descripción (opcional)
                    </Label>
                    <Textarea
                      id={`desc-${row._key}`}
                      value={row.description ?? ''}
                      onChange={(e) => updateRow(row._key, { description: e.target.value })}
                      rows={2}
                      placeholder="Cómo/dónde se captura este dato…"
                    />
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" onClick={addRow} className="self-start">
                <Plus className="mr-1 size-4" />
                Agregar variable
              </Button>
            </div>

            <ModalFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditorOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar datos esperados'}
              </Button>
            </ModalFooter>
          </div>
        </ModalContent>
      </Modal>
    </div>
  );
}
