import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  Briefcase,
  ChevronRight,
  FileText,
  FolderOpen,
  Plus,
  User,
} from 'lucide-react';
import { useFaenaProjects, useEligibleAdmins } from '@/hooks/use-project-hierarchy';
import { useClients } from '@/hooks/use-clients';
import { useFaenas } from '@/hooks/use-faenas';
import { useHasRole } from '@/hooks/use-has-role';
import { listDepartments } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Alert } from '@/components/ui/alert';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import type { ProjectType, CreateProjectInput } from '@/types/projects';
import type { ProjectView } from '@/types/operations';

/** Roles que habilitan la creación de proyectos (gate `project:create`, demo). */
const PROJECT_CREATE_ROLES = ['org_admin', 'department_admin'];

/** Tipos de proyecto disponibles con su etiqueta legible. */
const PROJECT_TYPES: Array<{ value: ProjectType; label: string }> = [
  { value: 'SPOT', label: 'Spot' },
  { value: 'OBRAS_CIVILES', label: 'Obras civiles' },
  { value: 'RUTINARIO', label: 'Rutinario' },
];

/** Lee un string de un objeto JSON sin tipar (KPIs); `undefined` si no aplica. */
function readString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Etiqueta legible del tipo de proyecto (o el crudo si es desconocido). */
function projectTypeLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return PROJECT_TYPES.find((t) => t.value === value)?.label ?? value;
}

/**
 * Extrae los campos de la jerarquía A0 (contractNumber / projectType /
 * projectAdmin) de un proyecto. `ProjectView` aún no los tipa como campos de
 * primer nivel, así que los leemos de forma defensiva del propio objeto y de
 * `kpis` (fallback), sin romper si el backend todavía no los envía.
 */
function readProjectMeta(proj: ProjectView): {
  contractNumber?: string;
  projectType?: string;
  adminName?: string;
} {
  const rec = proj as unknown as Record<string, unknown>;
  const kpis = proj.kpis ?? {};

  const contractNumber = readString(rec, 'contractNumber') ?? readString(kpis, 'contractNumber');
  const projectType = readString(rec, 'projectType') ?? readString(kpis, 'projectType');

  let adminName: string | undefined;
  const admin = rec.projectAdmin ?? rec.admin;
  if (admin && typeof admin === 'object') {
    const a = admin as Record<string, unknown>;
    const first = typeof a.firstName === 'string' ? a.firstName : '';
    const last = typeof a.lastName === 'string' ? a.lastName : '';
    const full = `${first} ${last}`.trim();
    if (full) adminName = full;
  }

  return { contractNumber, projectType, adminName };
}

/**
 * Capa 3 — Catálogo de Proyectos de una faena
 * (`/proyectos/cliente/:clientId/faena/:faenaId`).
 *
 * Grilla de cards con los datos clave del proyecto (código, nombre, tipo, número
 * de contrato, administrador), buscador y un formulario (dialog) de creación
 * gateado por rol (`project:create`). El cliente y la faena del formulario se
 * autocompletan desde la ruta pero son editables; si el usuario los cambia, se
 * pide una confirmación explícita antes de crear el proyecto en otra ubicación.
 * Al crear, navega al detalle del proyecto (`/proyectos/proyecto/:id`).
 */
export default function FaenaProyectosPage() {
  const { clientId, faenaId } = useParams<{ clientId: string; faenaId: string }>();
  const navigate = useNavigate();

  const { projects, loading, error, create } = useFaenaProjects(faenaId);
  const { clients } = useClients();
  const { faenas } = useFaenas(clientId);
  const { admins } = useEligibleAdmins();
  const canCreate = useHasRole(PROJECT_CREATE_ROLES);

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const client = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);
  const faena = useMemo(() => faenas.find((f) => f.id === faenaId) ?? null, [faenas, faenaId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const meta = readProjectMeta(p);
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (meta.contractNumber?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [projects, search]);

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav
        aria-label="Ruta de navegación"
        className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      >
        <Link to="/proyectos" className="hover:text-foreground">
          Clientes
        </Link>
        <ChevronRight className="size-3" aria-hidden />
        <Link to={`/proyectos/cliente/${clientId}`} className="hover:text-foreground">
          {client?.name ?? 'Cliente'}
        </Link>
        <ChevronRight className="size-3" aria-hidden />
        <span className="font-medium text-foreground">{faena?.name ?? 'Faena'}</span>
      </nav>

      {/* Encabezado + acción */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Proyectos de la faena</h1>
          <p className="text-sm text-muted-foreground">
            {faena?.name ?? 'Faena'}
            {faena?.code ? ` · ${faena.code}` : ''}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="mr-2 size-4" />
            Nuevo proyecto
          </Button>
        )}
      </div>

      {/* Buscador */}
      <SearchInput
        className="max-w-sm flex-none"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre, código o contrato…"
        label="Buscar proyectos"
      />

      {/* Contenido: carga / error / vacío / grilla */}
      {loading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-44 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={projects.length === 0 ? 'No hay proyectos' : 'Sin resultados'}
          message={
            projects.length === 0
              ? 'Esta faena todavía no tiene proyectos.'
              : 'Ningún proyecto coincide con tu búsqueda.'
          }
          action={
            projects.length === 0 && canCreate ? (
              <Button onClick={() => setModalOpen(true)}>
                <Plus className="mr-2 size-4" />
                Crear el primer proyecto
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((proj) => {
            const meta = readProjectMeta(proj);
            const typeLabel = projectTypeLabel(meta.projectType);
            return (
              <Card
                key={proj.id}
                className="cursor-pointer bg-card/60 transition-all hover:border-primary/30 hover:shadow-xs"
                onClick={() => navigate(`/proyectos/proyecto/${proj.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/proyectos/proyecto/${proj.id}`);
                  }
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Briefcase className="size-4 shrink-0 text-primary" />
                      <CardTitle className="text-md line-clamp-1">{proj.name}</CardTitle>
                    </div>
                    <Badge variant="outline">{proj.code}</Badge>
                  </div>
                  {typeLabel && (
                    <CardDescription className="text-xs">
                      <Badge variant="secondary" className="font-normal">
                        {typeLabel}
                      </Badge>
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col gap-2 pb-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0" aria-hidden />
                    <span className="line-clamp-1">
                      Contrato: {meta.contractNumber ?? 'Sin número'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="size-3.5 shrink-0" aria-hidden />
                    <span className="line-clamp-1">
                      Admin: {meta.adminName ?? 'Sin asignar'}
                    </span>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end pb-3 pt-0">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    Ver detalle
                    <ArrowRight className="size-3" />
                  </span>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog de creación */}
      <NewProjectDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        clientId={clientId ?? ''}
        faenaId={faenaId ?? ''}
        clients={clients}
        admins={admins}
        onCreate={async (dto) => {
          const created = await create(dto);
          toast.success('Proyecto creado.');
          navigate(`/proyectos/proyecto/${created.id}`);
        }}
      />
    </div>
  );
}

/* ========================================================================== */
/* Dialog de creación de proyecto                                             */
/* ========================================================================== */

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  faenaId: string;
  clients: Array<{ id: string; name: string; code: string }>;
  admins: Array<{ id: string; firstName: string; lastName: string; email: string }>;
  onCreate: (dto: CreateProjectInput) => Promise<void>;
}

function NewProjectDialog({
  open,
  onOpenChange,
  clientId,
  faenaId,
  clients,
  admins,
  onCreate,
}: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('RUTINARIO');
  const [projectAdminId, setProjectAdminId] = useState('');
  // Cliente / faena autocompletados desde la ruta, pero editables.
  const [formClientId, setFormClientId] = useState(clientId);
  const [formFaenaId, setFormFaenaId] = useState(faenaId);
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<
    Array<{ id: string; name: string; code: string }>
  >([]);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Faenas del cliente elegido en el formulario. Si el usuario cambia de
  // cliente, cargamos las faenas de ESE cliente (no las de la ruta) para que el
  // selector de faena sea coherente con el cliente seleccionado.
  const { faenas: faenasForClient } = useFaenas(open ? formClientId || undefined : undefined);

  // El diálogo permanece montado (Modal controla su visibilidad), así que al
  // (re)abrirlo restauramos el formulario a los valores precargados de la ruta.
  useEffect(() => {
    if (!open) return;
    setName('');
    setCode('');
    setContractNumber('');
    setDescription('');
    setProjectType('RUTINARIO');
    setProjectAdminId('');
    setFormClientId(clientId);
    setFormFaenaId(faenaId);
    setFormError(null);
  }, [open, clientId, faenaId]);

  // departmentId: el DTO extendido no lo exige, pero `POST /projects` sí lo
  // necesita. Lo resolvemos con un selector poblado por `listDepartments()` y
  // preseleccionamos el primero para no dejarlo vacío nunca.
  useEffect(() => {
    let active = true;
    listDepartments()
      .then((list) => {
        if (!active) return;
        setDepartments(list);
        const first = list[0];
        if (first) setDepartmentId((prev) => prev || first.id);
      })
      .catch(() => {
        /* silencioso: el submit mostrará el error si falta departamento */
      });
    return () => {
      active = false;
    };
  }, []);

  // Al cambiar de cliente, la faena seleccionada deja de pertenecer al nuevo
  // cliente: la limpiamos para no crear una combinación inconsistente (a menos
  // que sea el cliente de la ruta, donde conservamos la faena precargada).
  const handleClientChange = (nextClientId: string) => {
    setFormClientId(nextClientId);
    setFormFaenaId(nextClientId === clientId ? faenaId : '');
  };

  const locationChanged = formClientId !== clientId || formFaenaId !== faenaId;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim() || !code.trim()) {
      setFormError('Nombre y código son obligatorios.');
      return;
    }
    if (!formClientId) {
      setFormError('Selecciona un cliente.');
      return;
    }
    if (!departmentId) {
      setFormError('Selecciona un departamento.');
      return;
    }

    // Confirmación si el proyecto se creará en otra ubicación (cliente/faena
    // distintos a los de la ruta).
    if (locationChanged) {
      const ok = window.confirm(
        'Vas a crear el proyecto en otra ubicación (cliente o faena distintos a los actuales). ¿Seguro que deseas continuar?',
      );
      if (!ok) return;
    }

    const dto: CreateProjectInput = {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      clientId: formClientId,
      projectType,
      ...(formFaenaId ? { faenaId: formFaenaId } : {}),
      ...(contractNumber.trim() ? { contractNumber: contractNumber.trim() } : {}),
      ...(projectAdminId ? { projectAdminId } : {}),
    };
    // `description` y `departmentId` no están en `CreateProjectInput` pero el
    // backend los acepta (contrato extendido). Se anexan sin romper el tipo.
    const payload = {
      ...dto,
      departmentId,
      ...(description.trim() ? { description: description.trim() } : {}),
    } as CreateProjectInput;

    setSubmitting(true);
    try {
      await onCreate(payload);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo crear el proyecto.');
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ModalHeader>
            <ModalTitle>Nuevo proyecto</ModalTitle>
            <ModalDescription>
              Registra un proyecto en la faena. El cliente y la faena vienen
              precargados de la ubicación actual.
            </ModalDescription>
          </ModalHeader>

          {formError && (
            <Alert variant="destructive" live>
              {formError}
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-name">Nombre del proyecto</Label>
            <Input
              id="np-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Monitoreo geotécnico rampa norte"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-code">Código (3-4 chars)</Label>
              <Input
                id="np-code"
                required
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                placeholder="Ej. MON1"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-contract">N.º de contrato</Label>
              <Input
                id="np-contract"
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="Ej. CTR-2026-014"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-client">Cliente</Label>
              <Select
                id="np-client"
                aria-label="Cliente del proyecto"
                value={formClientId}
                onChange={(e) => handleClientChange(e.target.value)}
              >
                {clients.length === 0 && <option value="">Sin clientes</option>}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-faena">Faena</Label>
              <Select
                id="np-faena"
                aria-label="Faena del proyecto"
                value={formFaenaId}
                onChange={(e) => setFormFaenaId(e.target.value)}
              >
                <option value="">Sin faena</option>
                {faenasForClient.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {locationChanged && (
            <Alert variant="warning">
              Cambiaste el cliente o la faena: el proyecto se creará en una
              ubicación distinta a la actual. Se pedirá confirmación al crear.
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-type">Tipo de proyecto</Label>
              <Select
                id="np-type"
                aria-label="Tipo de proyecto"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value as ProjectType)}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-dept">Departamento</Label>
              <Select
                id="np-dept"
                aria-label="Departamento del proyecto"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                {departments.length === 0 && <option value="">Cargando…</option>}
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-admin">Administrador de proyecto</Label>
            <Select
              id="np-admin"
              aria-label="Administrador de proyecto"
              value={projectAdminId}
              onChange={(e) => setProjectAdminId(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.firstName} {a.lastName} ({a.email})
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-desc">Descripción</Label>
            <Textarea
              id="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Alcance breve del proyecto (opcional)."
            />
          </div>

          <ModalFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creando…' : 'Crear proyecto'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
