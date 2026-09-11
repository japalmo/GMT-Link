import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { HardHat, Plus, Search, Star, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  createFieldWorker,
  deleteFieldWorker,
  errorToMessage,
  listFieldWorkers,
  setTaskCrewBulk,
} from '@/lib/api';
import type { FieldWorker } from '@gmt-platform/contracts';
import type { CrewUser, TaskView } from '@/types/operations';

/**
 * Cuadrilla de faena: la gente que va a terreno.
 *
 * Las fichas no son cuentas. Se crean con nombre, apellido y cargo, y sirven
 * para armar cuadrillas, aparecer en el kanban y contarse en el tablero de obra.
 * Nadie recibe credenciales porque no hay ninguna que recibir.
 */

/** Iniciales para el disco de la persona. */
export function iniciales(firstName: string, lastName: string): string {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase();
}

export function nombreCorto(firstName: string, lastName: string): string {
  return `${firstName.split(' ')[0] ?? firstName} ${lastName.split(' ')[0] ?? lastName}`.trim();
}

/**
 * Los discos con las iniciales de la cuadrilla. El jefe lleva un anillo ámbar.
 * Es lo que se ve en una tarjeta de kanban o en una fila del plan: quién va,
 * sin gastar el ancho que costaría escribir los nombres.
 */
export function Cuadrilla({
  crew,
  max = 4,
  size = 'sm',
}: {
  crew: Array<{ lead: boolean; user: CrewUser }>;
  /** Cuántos discos se dibujan antes de resumir el resto en "+N". */
  max?: number;
  size?: 'sm' | 'md';
}): ReactNode {
  if (crew.length === 0) {
    return <span className="text-xs text-muted-foreground">Sin cuadrilla</span>;
  }
  const visibles = crew.slice(0, max);
  const resto = crew.length - visibles.length;
  const clase = size === 'md' ? 'size-8 text-xs' : 'size-6 text-[10px]';

  return (
    <div className="flex items-center -space-x-1.5">
      {visibles.map(({ lead, user }) => (
        <span
          key={user.id}
          title={`${user.firstName} ${user.lastName}${user.cargo ? ` · ${user.cargo}` : ''}${
            lead ? ' · jefe de cuadrilla' : ''
          }`}
          className={`flex ${clase} items-center justify-center rounded-full border font-semibold ${
            lead
              ? 'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
              : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          {iniciales(user.firstName, user.lastName)}
        </span>
      ))}
      {resto > 0 && (
        <span
          className={`flex ${clase} items-center justify-center rounded-full border border-border bg-background font-semibold text-muted-foreground`}
          title={crew
            .slice(max)
            .map((m) => `${m.user.firstName} ${m.user.lastName}`)
            .join(', ')}
        >
          +{resto}
        </span>
      )}
    </div>
  );
}

// ── Alta rápida de una ficha ────────────────────────────────────────────────

export function NuevoTrabajador({
  abierto,
  onAbierto,
  onCreado,
}: {
  abierto: boolean;
  onAbierto: (v: boolean) => void;
  onCreado: (w: FieldWorker) => void;
}): ReactNode {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cargo, setCargo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function limpiar(): void {
    setFirstName('');
    setLastName('');
    setCargo('');
    setError(null);
  }

  async function guardar(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const w = await createFieldWorker({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        cargo: cargo.trim() || null,
      });
      onCreado(w);
      toast.success(`${w.firstName} ${w.lastName} quedó en el listado.`);
      limpiar();
      onAbierto(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo agregar al trabajador.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={abierto} onOpenChange={(v) => (v ? onAbierto(true) : (limpiar(), onAbierto(false)))}>
      <ModalContent>
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <ModalHeader>
            <ModalTitle className="flex items-center gap-2">
              <HardHat className="size-4" aria-hidden />
              Agregar trabajador
            </ModalTitle>
            <ModalDescription>
              Queda en el listado de la empresa y se puede asignar a las etapas de cualquier obra.
              No se le crea cuenta ni se le envía nada.
            </ModalDescription>
          </ModalHeader>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trab-nombre">Nombre</Label>
              <Input
                id="trab-nombre"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trab-apellido">Apellido</Label>
              <Input
                id="trab-apellido"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trab-cargo">Cargo en faena</Label>
            <Input
              id="trab-cargo"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              placeholder="Maestro cerrajero, ayudante, topógrafo…"
            />
          </div>

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => onAbierto(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando || !firstName.trim() || !lastName.trim()}>
              {guardando ? 'Guardando…' : 'Agregar'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

// ── Listado maestro ─────────────────────────────────────────────────────────

/** El listado de trabajadores de la empresa, con alta y baja. */
export function ListaTrabajadores(): ReactNode {
  const [workers, setWorkers] = useState<FieldWorker[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [borrando, setBorrando] = useState<FieldWorker | null>(null);

  const recargar = useCallback(() => {
    setCargando(true);
    listFieldWorkers()
      .then(setWorkers)
      .catch((err) => setError(errorToMessage(err, 'No se pudo cargar el listado.')))
      .finally(() => setCargando(false));
  }, []);

  useEffect(recargar, [recargar]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter((w) =>
      `${w.firstName} ${w.lastName} ${w.cargo ?? ''}`.toLowerCase().includes(q),
    );
  }, [workers, busqueda]);

  async function borrar(w: FieldWorker): Promise<void> {
    try {
      await deleteFieldWorker(w.id, true);
      setWorkers((prev) => prev.filter((x) => x.id !== w.id));
      toast.success(
        w.assignments > 0
          ? `${nombreCorto(w.firstName, w.lastName)} salió del listado y de ${w.assignments} ${
              w.assignments === 1 ? 'tarea' : 'tareas'
            }.`
          : `${nombreCorto(w.firstName, w.lastName)} salió del listado.`,
      );
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo quitar al trabajador.'));
    } finally {
      setBorrando(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o cargo…"
            className="pl-8"
            aria-label="Buscar trabajador"
          />
        </div>
        <Button size="sm" onClick={() => setNuevoAbierto(true)}>
          <Plus className="mr-1 size-4" aria-hidden />
          Agregar trabajador
        </Button>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {cargando ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Cargando el listado…</p>
      ) : visibles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          {workers.length === 0
            ? 'Todavía no hay trabajadores en el listado.'
            : 'Ningún trabajador coincide con la búsqueda.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {visibles.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground">
                  {iniciales(w.firstName, w.lastName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {w.firstName} {w.lastName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {w.cargo ?? 'Sin cargo declarado'}
                    {w.assignments > 0 &&
                      ` · en ${w.assignments} ${w.assignments === 1 ? 'tarea' : 'tareas'}`}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar a ${w.firstName} ${w.lastName}`}
                onClick={() => setBorrando(w)}
              >
                <Trash2 className="size-4 text-destructive" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <NuevoTrabajador
        abierto={nuevoAbierto}
        onAbierto={setNuevoAbierto}
        onCreado={(w) => setWorkers((prev) => [...prev, w])}
      />

      <Modal open={borrando !== null} onOpenChange={(v) => !v && setBorrando(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Quitar del listado</ModalTitle>
            <ModalDescription>
              {borrando && borrando.assignments > 0
                ? `${borrando.firstName} ${borrando.lastName} está en ${borrando.assignments} ${
                    borrando.assignments === 1 ? 'tarea' : 'tareas'
                  }. Al quitarlo sale también de esas cuadrillas.`
                : `${borrando?.firstName} ${borrando?.lastName} sale del listado de la empresa.`}
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setBorrando(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => borrando && borrar(borrando)}>
              Quitar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ── Asignar cuadrilla ───────────────────────────────────────────────────────

/** Qué etapas va a tocar el diálogo y cómo se llama lo que se está editando. */
export interface ObjetivoCuadrilla {
  /** Una etapa, o todas las de un cerco. */
  tareas: TaskView[];
  /** Rótulo de lo que se edita: el nombre de la etapa o el del cerco. */
  titulo: string;
}

/**
 * Diálogo para decir quiénes van y quién manda.
 *
 * Acepta VARIAS etapas porque el gesto real es uno: un cerco tiene siete etapas
 * y casi siempre va la misma cuadrilla. Hacerlo de a una eran siete diálogos
 * para una sola decisión.
 *
 * La cuadrilla se manda completa y no como altas y bajas sueltas: así lo que se
 * guarda es exactamente lo que muestra la pantalla.
 */
export function AsignarCuadrilla({
  objetivo,
  opciones,
  agregar,
  onAgregado,
  onCerrar,
  onGuardado,
  onNuevoTrabajador,
}: {
  objetivo: ObjetivoCuadrilla | null;
  opciones: FieldWorker[];
  /**
   * Id de un trabajador recién creado desde este mismo diálogo. Entra a la
   * selección solo: se creó porque falta en ESTA etapa, y obligar a buscarlo
   * después de escribir su nombre sería pedir el dato dos veces.
   */
  agregar?: string | null;
  onAgregado?: () => void;
  onCerrar: () => void;
  onGuardado: (actualizadas: TaskView[]) => void;
  onNuevoTrabajador: () => void;
}): ReactNode {
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [jefe, setJefe] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tareas = objetivo?.tareas ?? [];

  // Al abrir, el diálogo parte de la cuadrilla que ya hay. Con varias etapas se
  // precarga solo si TODAS tienen la misma: si difieren, arranca vacío en vez
  // de elegir una en silencio y pisar las otras sin avisar.
  useEffect(() => {
    if (!objetivo || tareas.length === 0) {
      setSeleccion([]);
      setJefe(null);
      setBusqueda('');
      setError(null);
      return;
    }
    const firmas = tareas.map((t) =>
      (t.crew ?? [])
        .map((m) => `${m.userId}:${m.lead ? 1 : 0}`)
        .sort()
        .join('|'),
    );
    const iguales = firmas.every((f) => f === firmas[0]);
    const base = iguales ? (tareas[0]?.crew ?? []) : [];
    setSeleccion(base.map((m) => m.userId));
    setJefe(base.find((m) => m.lead)?.userId ?? null);
    setBusqueda('');
    setError(null);
    // `objetivo` cambia de identidad al abrir otro: es la señal correcta.
  }, [objetivo]);

  useEffect(() => {
    if (!agregar) return;
    setSeleccion((prev) => (prev.includes(agregar) ? prev : [...prev, agregar]));
    onAgregado?.();
  }, [agregar, onAgregado]);

  const mezcladas = useMemo(() => {
    if (tareas.length < 2) return false;
    const firmas = tareas.map((t) =>
      (t.crew ?? []).map((m) => m.userId).sort().join('|'),
    );
    return !firmas.every((f) => f === firmas[0]);
  }, [tareas]);

  const porId = useMemo(() => new Map(opciones.map((o) => [o.id, o])), [opciones]);
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return opciones;
    return opciones.filter((o) =>
      `${o.firstName} ${o.lastName} ${o.cargo ?? ''}`.toLowerCase().includes(q),
    );
  }, [opciones, busqueda]);

  function alternar(id: string): void {
    setSeleccion((prev) => {
      if (prev.includes(id)) {
        // Si sale el jefe, la cuadrilla queda sin jefe en vez de heredarlo a
        // alguien que nadie eligió.
        if (jefe === id) setJefe(null);
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  }

  async function guardar(): Promise<void> {
    if (tareas.length === 0 || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const actualizadas = await setTaskCrewBulk({
        taskIds: tareas.map((t) => t.id),
        userIds: seleccion,
        leadUserId: jefe,
      });
      onGuardado(actualizadas);
      const donde =
        tareas.length === 1 ? 'la etapa' : `las ${tareas.length} etapas`;
      toast.success(
        seleccion.length === 0
          ? `Quitaste la cuadrilla de ${donde}.`
          : `Cuadrilla de ${seleccion.length} en ${donde}.`,
      );
      onCerrar();
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar la cuadrilla.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={objetivo !== null} onOpenChange={(v) => !v && onCerrar()}>
      <ModalContent className="sm:max-w-lg">
        <div className="flex min-h-0 flex-col gap-4">
          <ModalHeader>
            <ModalTitle className="flex items-center gap-2">
              <UserRound className="size-4" aria-hidden />
              {tareas.length > 1 ? `Cuadrilla · ${tareas.length} etapas` : 'Cuadrilla de la etapa'}
            </ModalTitle>
            <ModalDescription>{objetivo?.titulo}</ModalDescription>
          </ModalHeader>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          {mezcladas && (
            <Alert>
              Estas etapas hoy tienen cuadrillas distintas. Lo que guardes acá reemplaza la de
              todas.
            </Alert>
          )}

          {seleccion.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {seleccion.map((id) => {
                const w = porId.get(id);
                if (!w) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
                  >
                    {jefe === id && <Star className="size-3 fill-amber-400 text-amber-500" aria-hidden />}
                    {nombreCorto(w.firstName, w.lastName)}
                    <button
                      type="button"
                      onClick={() => alternar(id)}
                      aria-label={`Sacar a ${w.firstName} ${w.lastName}`}
                      className="rounded-full p-0.5 hover:bg-background"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar trabajador…"
              className="pl-8"
              aria-label="Buscar trabajador"
            />
          </div>

          <ul className="flex max-h-[280px] flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {visibles.length === 0 && (
              <li className="p-4 text-center text-sm text-muted-foreground">
                {opciones.length === 0
                  ? 'No hay trabajadores en el listado todavía.'
                  : 'Nadie coincide con la búsqueda.'}
              </li>
            )}
            {visibles.map((w) => {
              const dentro = seleccion.includes(w.id);
              return (
                <li key={w.id} className="flex items-center gap-2 p-2">
                  <button
                    type="button"
                    onClick={() => alternar(w.id)}
                    aria-pressed={dentro}
                    className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 text-left transition-colors ${
                      dentro ? 'bg-muted' : 'hover:bg-muted/60'
                    }`}
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                        dentro
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      {iniciales(w.firstName, w.lastName)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {w.firstName} {w.lastName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {w.cargo ?? 'Sin cargo declarado'}
                      </span>
                    </span>
                  </button>
                  {dentro && (
                    <Button
                      type="button"
                      variant={jefe === w.id ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setJefe(jefe === w.id ? null : w.id)}
                      title="Marcar como jefe de cuadrilla"
                    >
                      <Star
                        className={`mr-1 size-3.5 ${jefe === w.id ? 'fill-amber-400 text-amber-500' : ''}`}
                        aria-hidden
                      />
                      Jefe
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <ModalFooter className="items-center justify-between gap-2 sm:justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={onNuevoTrabajador}>
              <Plus className="mr-1 size-4" aria-hidden />
              Falta alguien
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onCerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="button" onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar cuadrilla'}
              </Button>
            </div>
          </ModalFooter>
        </div>
      </ModalContent>
    </Modal>
  );
}
