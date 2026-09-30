import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Filter,
  Pencil,
  Search,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorToMessage, getCrewOptions } from '@/lib/api';
import type { FieldWorker } from '@gmt-platform/contracts';
import type { CrewUser, TaskView } from '@/types/operations';
import {
  AsignarCuadrilla,
  Cuadrilla,
  NuevoTrabajador,
  nombreCorto,
  type ObjetivoCuadrilla,
} from './cuadrilla';

/**
 * Plan de actividades de la obra.
 *
 * En el Cierre Perimetral son 63 cercos por 7 etapas: 441 filas más las
 * partidas del programa. Una lista plana de ese tamaño no se usa, así que la
 * vista agrupa por actividad y cada etapa es su propia fila, con su estado, su
 * responsable y su cuadrilla. El buscador mira dentro de las etapas y de los
 * nombres de la gente asignada, no solo el título del grupo: quien busca "DGR"
 * o "Pérez" quiere ver en qué está metido, no la actividad que lo contiene.
 */

const ESTADOS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'EN_PROGRESO', label: 'En progreso' },
  { value: 'REVISADO', label: 'En revisión' },
  { value: 'COMPLETADO', label: 'Completada' },
] as const;

const NOMBRE_ESTADO: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROGRESO: 'En progreso',
  REVISADO: 'En revisión',
  COMPLETADO: 'Completada',
};

const COLOR_ESTADO: Record<string, string> = {
  PENDIENTE: 'bg-muted text-muted-foreground',
  EN_PROGRESO: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  REVISADO: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
  COMPLETADO: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
};

function fecha(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}-${m}` : null;
}

/** Todo el texto por el que se puede encontrar una etapa. */
function textoBuscable(t: TaskView, padre: string): string {
  const gente = (t.crew ?? [])
    .map((c) => `${c.user.firstName} ${c.user.lastName} ${c.user.cargo ?? ''}`)
    .join(' ');
  const responsable = t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : '';
  return `${padre} ${t.name} ${responsable} ${gente}`.toLowerCase();
}

export function PlanActividades({
  projectId,
  tasks,
  canManage,
  onPatch,
  onEditar,
  onBorrar,
}: {
  projectId: string;
  tasks: TaskView[];
  canManage: boolean;
  /** Reemplaza en memoria las tareas que ya volvieron del servidor. */
  onPatch: (actualizadas: TaskView[]) => void;
  onEditar: (t: TaskView) => void;
  onBorrar: (t: TaskView) => void;
}): ReactNode {
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState<string>('all');
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [asignando, setAsignando] = useState<ObjetivoCuadrilla | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [preseleccion, setPreseleccion] = useState<string | null>(null);
  const [trabajadores, setTrabajadores] = useState<FieldWorker[]>([]);
  const [errorTrabajadores, setErrorTrabajadores] = useState<string | null>(null);

  // Las fichas para el selector se piden al montar y se reusan en cada etapa:
  // son las mismas para toda la obra y pedirlas al abrir cada diálogo se nota.
  // No hace falta refrescarlas a mano: la pestaña se desmonta al cambiar de
  // solapa, así que volver desde Trabajadores ya trae la lista al día.
  useEffect(() => {
    let vivo = true;
    getCrewOptions(projectId)
      .then((opciones) => {
        if (!vivo) return;
        setTrabajadores(
          opciones.map((o) => ({
            id: o.id,
            firstName: o.firstName,
            lastName: o.lastName,
            cargo: o.cargo,
            assignments: 0,
          })),
        );
      })
      .catch((err) => {
        if (vivo) setErrorTrabajadores(errorToMessage(err, 'No se pudo cargar el listado.'));
      });
    return () => {
      vivo = false;
    };
  }, [projectId]);

  const grupos = useMemo(() => {
    const hijas = new Map<string, TaskView[]>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const lista = hijas.get(t.parentId) ?? [];
      lista.push(t);
      hijas.set(t.parentId, lista);
    }
    return tasks
      .filter((t) => !t.parentId)
      .map((raiz) => ({ raiz, etapas: hijas.get(raiz.id) ?? [] }));
  }, [tasks]);

  const q = busqueda.trim().toLowerCase();

  const filtrados = useMemo(() => {
    return grupos
      .map(({ raiz, etapas }) => {
        const pasaEstado = (t: TaskView) => estado === 'all' || t.status === estado;
        // Una actividad sin etapas se mide por sí misma; una con etapas, por
        // las suyas: filtrar el grupo por el estado del padre escondería la
        // única etapa en progreso de un cerco que sigue "pendiente".
        const propias = etapas.length > 0 ? etapas : [raiz];
        const visiblesPorEstado = propias.filter(pasaEstado);
        if (visiblesPorEstado.length === 0) return null;

        if (!q) return { raiz, etapas, visibles: etapas.length > 0 ? visiblesPorEstado : [] };

        const grupoCoincide = raiz.name.toLowerCase().includes(q);
        const etapasCoinciden = visiblesPorEstado.filter((t) =>
          textoBuscable(t, raiz.name).includes(q),
        );
        if (!grupoCoincide && etapasCoinciden.length === 0) return null;
        return {
          raiz,
          etapas,
          visibles: etapas.length > 0 ? (grupoCoincide ? visiblesPorEstado : etapasCoinciden) : [],
        };
      })
      .filter((g): g is { raiz: TaskView; etapas: TaskView[]; visibles: TaskView[] } => g !== null);
  }, [grupos, q, estado]);

  // Buscar abre los grupos: si hay que hacer clic para ver el resultado, el
  // buscador no está resolviendo nada. Filtrar por estado NO los abre: con 63
  // cercos, elegir "Pendiente" pintaría 441 filas de una vez. Para eso está el
  // botón de desplegar, que es una decisión del usuario y no un efecto lateral.
  const [todoAbierto, setTodoAbierto] = useState(false);
  const expandidoPorBusqueda = q.length > 0 || todoAbierto;

  function alternar(id: string): void {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Solo etapas de verdad: una partida del programa sin hijas no es una etapa.
  const totalEtapas = filtrados.reduce((s, g) => s + g.etapas.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cerco, etapa, sector o persona…"
            className="pl-8"
            aria-label="Buscar en el plan"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" aria-hidden />
          <Select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            aria-label="Filtrar por estado"
            className="w-[180px]"
          >
            {ESTADOS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setTodoAbierto((v) => !v)}
          disabled={q.length > 0}
          title={q.length > 0 ? 'La búsqueda ya abre los resultados' : undefined}
        >
          {todoAbierto ? (
            <ChevronsDownUp className="mr-1 size-4" aria-hidden />
          ) : (
            <ChevronsUpDown className="mr-1 size-4" aria-hidden />
          )}
          {todoAbierto ? 'Plegar todo' : 'Desplegar todo'}
        </Button>

        <span className="text-sm text-muted-foreground">
          {filtrados.length} {filtrados.length === 1 ? 'actividad' : 'actividades'}
          {totalEtapas > 0 && ` · ${totalEtapas} ${totalEtapas === 1 ? 'etapa' : 'etapas'}`}
        </span>
      </div>

      {errorTrabajadores && (
        <p className="text-sm text-destructive" role="alert">
          {errorTrabajadores}
        </p>
      )}

      {filtrados.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Ninguna actividad coincide con la búsqueda.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtrados.map(({ raiz, etapas, visibles }) => {
            const abierto = abiertos.has(raiz.id) || expandidoPorBusqueda;
            const listas = etapas.filter((t) => t.status === 'COMPLETADO').length;
            // La cuadrilla del grupo es la de todas sus etapas, sin repetidos.
            const porPersona = new Map<string, { lead: boolean; user: CrewUser }>();
            for (const t of [...etapas, raiz]) {
              for (const m of t.crew ?? []) {
                const previo = porPersona.get(m.userId);
                if (!previo || (m.lead && !previo.lead)) {
                  porPersona.set(m.userId, { lead: m.lead, user: m.user });
                }
              }
            }
            const cuadrillaGrupo = [...porPersona.values()].sort(
              (x, y) => Number(y.lead) - Number(x.lead),
            );

            return (
              <li key={raiz.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-3 p-3">
                  {/* Una partida sin etapas no se pliega: abrirla no mostraba
                      nada y el chevron prometía contenido que no existe. */}
                  <button
                    type="button"
                    onClick={() => etapas.length > 0 && alternar(raiz.id)}
                    aria-expanded={etapas.length > 0 ? abierto : undefined}
                    disabled={etapas.length === 0}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  >
                    <ChevronRight
                      className={`size-4 shrink-0 transition-transform ${
                        etapas.length === 0
                          ? 'invisible'
                          : `text-muted-foreground ${abierto ? 'rotate-90' : ''}`
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{raiz.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {etapas.length > 0
                          ? `${listas} de ${etapas.length} etapas listas`
                          : (NOMBRE_ESTADO[raiz.status] ?? raiz.status)}
                        {fecha(raiz.startDate) && ` · desde ${fecha(raiz.startDate)}`}
                        {fecha(raiz.dueDate) && ` · entrega ${fecha(raiz.dueDate)}`}
                      </span>
                    </span>
                  </button>

                  <Cuadrilla crew={cuadrillaGrupo} />

                  {canManage && (
                    <div className="flex items-center gap-1">
                      {/* Un cerco son siete etapas con la misma gente: el gesto
                          natural es asignar el cerco entero, no etapa por etapa. */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setAsignando({
                            tareas: etapas.length > 0 ? etapas : [raiz],
                            titulo:
                              etapas.length > 0 ? `${raiz.name} · todas las etapas` : raiz.name,
                          })
                        }
                      >
                        <Users className="mr-1 size-3.5" aria-hidden />
                        {etapas.length > 0 ? 'Cuadrilla del cerco' : 'Cuadrilla'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => onEditar(raiz)}
                        aria-label={`Editar ${raiz.name}`}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => onBorrar(raiz)}
                        aria-label={`Borrar ${raiz.name}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>

                {abierto && visibles.length > 0 && (
                  <ul className="divide-y divide-border border-t border-border bg-muted/20">
                    {visibles.map((etapa) => (
                      <li
                        key={etapa.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 pl-9"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">{etapa.name}</span>

                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                            COLOR_ESTADO[etapa.status] ?? 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {NOMBRE_ESTADO[etapa.status] ?? etapa.status}
                        </span>

                        {etapa.assignedTo && (
                          <span
                            className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex"
                            title="Responsable con cuenta en GMT Link"
                          >
                            <UserRound className="size-3.5" aria-hidden />
                            {nombreCorto(etapa.assignedTo.firstName, etapa.assignedTo.lastName)}
                          </span>
                        )}

                        {fecha(etapa.dueDate) && (
                          <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                            vence {fecha(etapa.dueDate)}
                          </span>
                        )}

                        <Cuadrilla crew={etapa.crew ?? []} />

                        {canManage && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setAsignando({
                                tareas: [etapa],
                                titulo: `${raiz.name} · ${etapa.name}`,
                              })
                            }
                          >
                            <Users className="mr-1 size-3.5" aria-hidden />
                            Cuadrilla
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AsignarCuadrilla
        objetivo={asignando}
        opciones={trabajadores}
        agregar={preseleccion}
        onAgregado={() => setPreseleccion(null)}
        onCerrar={() => setAsignando(null)}
        onGuardado={onPatch}
        onNuevoTrabajador={() => setNuevoAbierto(true)}
      />

      <NuevoTrabajador
        abierto={nuevoAbierto}
        onAbierto={setNuevoAbierto}
        onCreado={(w) => {
          setTrabajadores((prev) => [...prev, w]);
          // Se creó DESDE el diálogo de cuadrilla porque falta en esa etapa:
          // dejarlo fuera de la selección obligaría a buscarlo y marcarlo.
          setPreseleccion(w.id);
        }}
      />
    </div>
  );
}
