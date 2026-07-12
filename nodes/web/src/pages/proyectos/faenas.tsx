import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FolderKanban,
  FolderOpen,
  MapPin,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { Metric } from './index';
import { useClients } from '@/hooks/use-clients';
import { useFaenas } from '@/hooks/use-faenas';
import { useHasPermission } from '@/hooks/use-has-permission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Alert } from '@/components/ui/alert';
import { LocationPicker, type LocationValue } from '@/components/maps/location-picker';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
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
  const canCreate = useHasPermission('project:manage');

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  const [query, setQuery] = useState('');

  // Estado del dialog de creación. El código, estado, supervisor y fechas ya no
  // se piden aquí: el código se autogenera server-side y el resto se edita luego.
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState<LocationValue>({});
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
    setName('');
    setLocation({});
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
    if (!trimmedName) {
      setFormError('El nombre es obligatorio.');
      return;
    }
    const trimmedAddress = location.address?.trim();
    setSubmitting(true);
    try {
      const created = await create({
        name: trimmedName,
        ...(location.latitude !== undefined ? { latitude: location.latitude } : {}),
        ...(location.longitude !== undefined ? { longitude: location.longitude } : {}),
        ...(trimmedAddress ? { address: trimmedAddress } : {}),
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
    <PageContainer maxWidth="7xl">
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
      <PageHeader
        title={`Faenas${client ? ` de ${client.name}` : ''}`}
        description="Selecciona una faena para ver sus proyectos."
        actions={
          <>
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
          </>
        }
      />

      {/* Buscador */}
      <SearchInput
        className="max-w-md flex-none"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nombre o código…"
        label="Buscar faenas"
      />

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
        <ErrorState message={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={faenas.length === 0 ? 'No hay faenas' : 'Sin resultados'}
          message={
            faenas.length === 0
              ? 'Este cliente aún no tiene faenas registradas.'
              : 'Ninguna faena coincide con la búsqueda.'
          }
        />
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
              <Alert variant="destructive" live>
                {formError}
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="faena-name">Nombre</Label>
              <Input
                id="faena-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Rajo Norte"
              />
            </div>
            <Alert variant="info">
              El código se asignará automáticamente (formato{' '}
              {client ? `${client.code}-A` : 'COD_CLIENTE-A'}).
            </Alert>
            <div className="flex flex-col gap-1.5">
              <Label>
                Ubicación <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <LocationPicker
                value={location}
                onChange={setLocation}
                disabled={submitting}
                addressInputId="faena-address"
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
    </PageContainer>
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
  // `status`/fechas ya no se fijan en la creación pero siguen en el modelo:
  // toleramos que vengan nulos sin romper la card.
  const meta = faena.status ? STATUS_META[faena.status] : null;
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
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              meta?.className ?? 'border-border bg-muted/40 text-muted-foreground'
            }`}
          >
            {meta?.label ?? '—'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex gap-2">
          <Metric
            icon={<FolderKanban className="size-4" />}
            value={faena.projectsCount}
            label="Proyectos"
          />
          <Metric
            icon={<TrendingUp className="size-4" />}
            value={faena.activeProjectsCount}
            label="Activos"
          />
          <Metric
            icon={<AlertCircle className="size-4" />}
            value={faena.pendingAlertsCount}
            label="Alertas"
            tone="alert"
          />
        </div>
        {(start || end) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {start ?? 'sin inicio'}
            {end ? ` a ${end}` : ''}
          </p>
        )}
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
