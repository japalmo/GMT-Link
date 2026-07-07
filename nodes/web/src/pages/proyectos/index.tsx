import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  FolderKanban,
  FolderOpen,
  Plus,
  Search,
  TrendingUp,
} from 'lucide-react';
import { useClients } from '@/hooks/use-clients';
import { useHasRole } from '@/hooks/use-has-role';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import type { ClientView } from '@/types/projects';

/** Roles que habilitan la creación de clientes (gate demo `client:create`). */
const CLIENT_CREATE_ROLES = ['org_admin', 'department_admin'];

/** Filtros del catálogo por estado de actividad del cliente. */
type ActivityFilter = 'todos' | 'activos' | 'sin-actividad';

const ACTIVITY_FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'activos', label: 'Con proyectos activos' },
  { value: 'sin-actividad', label: 'Sin actividad' },
];

/**
 * Capa 1 — Catálogo de Clientes (`/proyectos`). Grid de cards con el carrusel de
 * métricas (histórico, activos, alertas) de {@link ClientView}, buscador +
 * filtro y creación gateada. Card → `/proyectos/cliente/:id`. Imita el patrón de
 * `pages/operaciones/proyectos.tsx` (grid de cards → dialog CRUD).
 */
export default function ProyectosClientesPage() {
  const navigate = useNavigate();
  const { clients, loading, error, create } = useClients();
  const canCreate = useHasRole(CLIENT_CREATE_ROLES);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ActivityFilter>('todos');

  // Estado del dialog de creación.
  const [modalOpen, setModalOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rut, setRut] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.code.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === 'activos') return c.activeProjectsCount > 0;
      if (filter === 'sin-actividad') return c.projectsCount === 0;
      return true;
    });
  }, [clients, query, filter]);

  const resetForm = () => {
    setCode('');
    setName('');
    setRut('');
    setFormError(null);
  };

  const openModal = () => {
    resetForm();
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode || !trimmedName) {
      setFormError('Código y nombre son obligatorios.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await create({
        code: trimmedCode,
        name: trimmedName,
        ...(rut.trim() ? { rut: rut.trim() } : {}),
      });
      toast.success(`Cliente "${created.name}" creado.`);
      setModalOpen(false);
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo crear el cliente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Clientes</h1>
            <p className="text-sm text-muted-foreground">
              Catálogo de clientes mandantes. Selecciona uno para ver sus faenas.
            </p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={openModal}>
            <Plus className="mr-2 size-4" />
            Nuevo cliente
          </Button>
        )}
      </div>

      {/* Buscador + filtro */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o código…"
            className="pl-9"
            aria-label="Buscar clientes"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_FILTERS.map((f) => (
            <Button
              key={f.value}
              type="button"
              size="sm"
              variant={filter === f.value ? 'default' : 'outline'}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Estados: carga / error / contenido */}
      {loading ? (
        <div
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          aria-hidden
        >
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-48 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4" />
            <span>{error}</span>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/30 py-12 text-center">
          <FolderOpen className="mx-auto mb-3 size-10 text-muted-foreground/60" />
          <h3 className="text-lg font-semibold">
            {clients.length === 0 ? 'No hay clientes' : 'Sin resultados'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {clients.length === 0
              ? 'Aún no se ha registrado ningún cliente.'
              : 'Ningún cliente coincide con la búsqueda o el filtro.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onOpen={() => navigate(`/proyectos/cliente/${client.id}`)}
            />
          ))}
        </div>
      )}

      {/* Dialog crear cliente */}
      <Modal open={modalOpen} onOpenChange={(next) => (next ? setModalOpen(true) : closeModal())}>
        <ModalContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>Nuevo cliente</ModalTitle>
              <ModalDescription>Registra un cliente mandante.</ModalDescription>
            </ModalHeader>
            {formError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1 flex flex-col gap-1.5">
                <Label htmlFor="client-code">Código</Label>
                <Input
                  id="client-code"
                  required
                  maxLength={4}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
                  }
                  placeholder="ALS"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="client-name">Nombre</Label>
                <Input
                  id="client-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Anglo American Sur"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-rut">
                RUT <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="client-rut"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                placeholder="Ej. 76.123.456-7"
              />
            </div>
            <ModalFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={closeModal}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creando…' : 'Crear'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}

/** Métrica individual del carrusel de la card. Compartida con la Capa 2 (faenas). */
export function Metric({
  icon,
  value,
  label,
  tone = 'default',
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone?: 'default' | 'alert';
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-border/60 bg-card/50 p-2 text-center">
      <div
        className={
          tone === 'alert' && value > 0
            ? 'text-destructive'
            : 'text-muted-foreground'
        }
      >
        {icon}
      </div>
      <span
        className={
          tone === 'alert' && value > 0
            ? 'text-lg font-bold leading-none text-destructive'
            : 'text-lg font-bold leading-none text-foreground'
        }
      >
        {value}
      </span>
      <span className="text-[10px] leading-tight text-muted-foreground">{label}</span>
    </div>
  );
}

/** Card de un cliente con su fila de métricas. */
function ClientCard({ client, onOpen }: { client: ClientView; onOpen: () => void }) {
  return (
    <Card
      className="cursor-pointer bg-card/60 transition-all hover:border-primary/30 hover:shadow-xs"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0 text-primary" />
            <CardTitle className="line-clamp-1 text-md">{client.name}</CardTitle>
          </div>
          <Badge variant="outline">{client.code}</Badge>
        </div>
        {client.rut && (
          <CardDescription className="text-xs">RUT: {client.rut}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex gap-2">
          <Metric
            icon={<FolderKanban className="size-4" />}
            value={client.projectsCount}
            label="Proyectos"
          />
          <Metric
            icon={<TrendingUp className="size-4" />}
            value={client.activeProjectsCount}
            label="Activos"
          />
          <Metric
            icon={<AlertCircle className="size-4" />}
            value={client.pendingAlertsCount}
            label="Alertas"
            tone="alert"
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-end pb-3 pt-0">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          Ver faenas
          <ArrowRight className="size-3" />
        </span>
      </CardFooter>
    </Card>
  );
}
