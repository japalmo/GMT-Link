import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronRight,
  FolderKanban,
  FolderOpen,
  MapPin,
  Plus,
  Search,
} from 'lucide-react';
import { useClients } from '@/hooks/use-clients';
import { useFaenas } from '@/hooks/use-faenas';
import { useEligibleAdmins } from '@/hooks/use-project-hierarchy';
import { useHasRole } from '@/hooks/use-has-role';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
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
import type { FaenaStatus, FaenaView } from '@/types/projects';

/** Roles que habilitan la creación de faenas (gate demo `faena:create`). */
const FAENA_CREATE_ROLES = ['org_admin', 'department_admin'];

/** Metadatos de presentación por estado de faena. */
const STATUS_META: Record<
  FaenaStatus,
  { label: string; className: string }
> = {
  PLANIFICADA: {
    label: 'Planificada',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  EN_PROGRESO: {
    label: 'En progreso',
    className: 'border-primary/30 bg-primary/10 text-primary',
  },
  COMPLETADA: {
    label: 'Completada',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
};

const STATUS_OPTIONS: FaenaStatus[] = ['PLANIFICADA', 'EN_PROGRESO', 'COMPLETADA'];

/**
 * Clases del `<select>` nativo alineadas con el focus ring del DS (Input /
 * Textarea). No hay componente Select en el design system aún; hasta entonces
 * reusamos este estilo para mantener consistencia con los inputs.
 */
const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Capa 2 — Faenas de un cliente (`/proyectos/cliente/:clientId`). Catálogo de
 * cards con métricas por faena, buscador y creación gateada. Breadcrumb/volver a
 * Clientes; card → `/proyectos/cliente/:clientId/faena/:faenaId`.
 */
export default function ProyectosFaenasPage() {
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();

  const { clients } = useClients();
  const { faenas, loading, error, create } = useFaenas(clientId);
  const { admins } = useEligibleAdmins();
  const canCreate = useHasRole(FAENA_CREATE_ROLES);

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  const [query, setQuery] = useState('');

  // Estado del dialog de creación.
  const [modalOpen, setModalOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<FaenaStatus>('PLANIFICADA');
  const [supervisorId, setSupervisorId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faenas;
    return faenas.filter(
      (f) =>
        f.name.toLowerCase().includes(q) || f.code.toLowerCase().includes(q),
    );
  }, [faenas, query]);

  const resetForm = () => {
    setCode('');
    setName('');
    setStatus('PLANIFICADA');
    setSupervisorId('');
    setStartDate('');
    setEndDate('');
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
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) {
      setFormError('Código y nombre son obligatorios.');
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      setFormError('La fecha de término no puede ser anterior a la de inicio.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await create({
        code: trimmedCode,
        name: trimmedName,
        status,
        ...(supervisorId ? { supervisorId } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      toast.success(`Faena "${created.name}" creada.`);
      setModalOpen(false);
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo crear la faena.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={() => navigate('/proyectos')}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <FolderKanban className="size-3.5" />
          Clientes
        </button>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-foreground">
          {client?.name ?? 'Faenas'}
        </span>
      </nav>

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">
              Faenas{client ? ` — ${client.name}` : ''}
            </h1>
            <p className="text-sm text-muted-foreground">
              Selecciona una faena para ver sus proyectos.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/proyectos')}>
            <ArrowLeft className="mr-2 size-4" />
            Volver
          </Button>
          {canCreate && (
            <Button onClick={openModal}>
              <Plus className="mr-2 size-4" />
              Nueva faena
            </Button>
          )}
        </div>
      </div>

      {/* Buscador */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o código…"
          className="pl-9"
          aria-label="Buscar faenas"
        />
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
              className="h-44 animate-pulse rounded-lg border border-border bg-muted/40"
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
            {faenas.length === 0 ? 'No hay faenas' : 'Sin resultados'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {faenas.length === 0
              ? 'Este cliente aún no tiene faenas registradas.'
              : 'Ninguna faena coincide con la búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((faena) => (
            <FaenaCard
              key={faena.id}
              faena={faena}
              onOpen={() =>
                navigate(`/proyectos/cliente/${clientId}/faena/${faena.id}`)
              }
            />
          ))}
        </div>
      )}

      {/* Dialog crear faena */}
      <Modal open={modalOpen} onOpenChange={(next) => (next ? setModalOpen(true) : closeModal())}>
        <ModalContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle>Nueva faena</ModalTitle>
              <ModalDescription>
                {client
                  ? `Registra una faena para ${client.name}.`
                  : 'Registra una faena del cliente.'}
              </ModalDescription>
            </ModalHeader>
            {formError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1 flex flex-col gap-1.5">
                <Label htmlFor="faena-code">Código</Label>
                <Input
                  id="faena-code"
                  required
                  maxLength={4}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
                  }
                  placeholder="RT01"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="faena-name">Nombre</Label>
                <Input
                  id="faena-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Rajo Norte"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="faena-status">Estado</Label>
                <select
                  id="faena-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as FaenaStatus)}
                  className={selectClass}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="faena-supervisor">
                  Supervisor <span className="text-muted-foreground">(opc.)</span>
                </Label>
                <select
                  id="faena-supervisor"
                  value={supervisorId}
                  onChange={(e) => setSupervisorId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Sin asignar</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.firstName} {a.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="faena-start">
                  Inicio <span className="text-muted-foreground">(opc.)</span>
                </Label>
                <Input
                  id="faena-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="faena-end">
                  Término <span className="text-muted-foreground">(opc.)</span>
                </Label>
                <Input
                  id="faena-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
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

/** Formatea una fecha ISO (o `null`) a formato local corto. */
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Card de una faena con estado, métrica de proyectos y rango de fechas. */
function FaenaCard({ faena, onOpen }: { faena: FaenaView; onOpen: () => void }) {
  const meta = STATUS_META[faena.status];
  const start = fmtDate(faena.startDate);
  const end = fmtDate(faena.endDate);

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
            <MapPin className="size-4 shrink-0 text-primary" />
            <CardTitle className="line-clamp-1 text-md">{faena.name}</CardTitle>
          </div>
          <Badge variant="outline">{faena.code}</Badge>
        </div>
        <div className="pt-1">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
          >
            {meta.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FolderKanban className="size-3.5" />
            {faena.projectsCount} {faena.projectsCount === 1 ? 'proyecto' : 'proyectos'}
          </span>
          {(start || end) && (
            <span>
              {start ?? '—'}
              {end ? ` → ${end}` : ''}
            </span>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-end pb-3 pt-0">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          Ver proyectos
          <ArrowRight className="size-3" />
        </span>
      </CardFooter>
    </Card>
  );
}
