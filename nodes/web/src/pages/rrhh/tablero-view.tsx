import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  HardHat,
  ListChecks,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { HrDashboard } from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, getHrDashboard } from '@/lib/api';
import { ConsultaRrhh } from './consulta-tabla';
import type { EstadoConsulta, FiltrosConsulta, ModoConsulta } from './consulta-estado';
import { EtiquetaVigencia, fechaCorta, plural, TIPO_REQUISITO, type FichaTab } from './rrhh-shared';

/**
 * Tablero de RRHH.
 *
 * Arriba lo que se mira de un vistazo; abajo la consulta para responder
 * preguntas concretas. Cada número del tablero es también un atajo: al hacer
 * clic aplica los filtros que lo explican, así nadie tiene que adivinar de dónde
 * sale un "7 vencidos".
 *
 * Todo se calcula sobre lo cargado. No se muestran "faltantes" porque todavía no
 * hay una regla que diga qué exige cada cliente, y un dato sin cargar se informa
 * como tal, nunca como vigente.
 */

type Tono = 'neutro' | 'critico' | 'aviso';

const TONO: Record<Tono, { borde: string; icono: string }> = {
  neutro: { borde: 'border-l-border', icono: 'text-muted-foreground' },
  critico: { borde: 'border-l-red-500', icono: 'text-red-600 dark:text-red-400' },
  aviso: { borde: 'border-l-amber-500', icono: 'text-amber-600 dark:text-amber-400' },
};

export function TableroView({
  consulta,
  onConsulta,
  onAbrir,
  version,
}: {
  consulta: EstadoConsulta;
  onConsulta: (c: EstadoConsulta) => void;
  onAbrir: (userId: string, tab?: FichaTab) => void;
  /** Cambia al volver de una ficha, para recalcular con lo editado. */
  version: number;
}): ReactNode {
  const [data, setData] = useState<HrDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consultaRef = useRef<HTMLElement>(null);

  const cargar = useCallback(() => {
    setError(null);
    getHrDashboard()
      .then(setData)
      .catch((err) => setError(errorToMessage(err, 'No se pudo cargar el tablero.')));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, version]);

  function aplicar(modo: ModoConsulta, filtros: FiltrosConsulta): void {
    onConsulta({ modo, q: '', filtros });
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    consultaRef.current?.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && !data ? (
        <ErrorState message={error} onRetry={cargar} />
      ) : !data ? (
        <LoadingState rows={5} label="Cargando el tablero…" />
      ) : (
        <Resumen data={data} aplicar={aplicar} onAbrir={onAbrir} />
      )}

      <section
        ref={consultaRef}
        aria-labelledby="rrhh-consulta-titulo"
        className="flex scroll-mt-4 flex-col gap-3"
      >
        <div>
          <h2 id="rrhh-consulta-titulo" className="text-base font-semibold">
            Consulta
          </h2>
          <p className="text-sm text-muted-foreground">
            Combina filtros para responder quién tiene qué. Quedan guardados en la dirección de la
            página: al volver de una ficha siguen puestos.
          </p>
        </div>
        <ConsultaRrhh
          consulta={consulta}
          onConsulta={onConsulta}
          onAbrir={onAbrir}
          version={version}
        />
      </section>
    </div>
  );
}

function Resumen({
  data,
  aplicar,
  onAbrir,
}: {
  data: HrDashboard;
  aplicar: (modo: ModoConsulta, filtros: FiltrosConsulta) => void;
  onAbrir: (userId: string, tab?: FichaTab) => void;
}): ReactNode {
  const { personas, requisitos } = data;
  const hora = new Date(data.generatedAt).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Calculado a las {hora} sobre lo cargado. "Por vencer" son los próximos {data.diasPorVencer}{' '}
        días, la misma ventana de los avisos de la plataforma.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          icon={Users}
          titulo="Trabajadores"
          valor={personas.total}
          detalle={`${personas.conCuenta} con cuenta · ${personas.deFaena} de faena, sin cuenta`}
          accion="Ver por persona"
          onClick={() => aplicar('personas', {})}
        />
        <Indicador
          icon={AlertTriangle}
          titulo="Requisitos vencidos"
          valor={requisitos.vencidos}
          detalle={
            requisitos.vencidos === 0
              ? 'Nada vencido entre lo cargado'
              : `de ${plural(requisitos.personasConVencidos, 'persona', 'personas')}`
          }
          tono={requisitos.vencidos > 0 ? 'critico' : 'neutro'}
          accion="Ver vencidos"
          onClick={() => aplicar('requisitos', { vigencia: 'VENCIDO' })}
        />
        <Indicador
          icon={CalendarClock}
          titulo={`Por vencer en ${data.diasPorVencer} días`}
          valor={requisitos.porVencer}
          detalle={
            requisitos.porVencer === 0
              ? 'Nada próximo a vencer'
              : `de ${plural(requisitos.personasConPorVencer, 'persona', 'personas')}`
          }
          tono={requisitos.porVencer > 0 ? 'aviso' : 'neutro'}
          accion="Ver por vencer"
          onClick={() => aplicar('requisitos', { vigencia: 'POR_VENCER' })}
        />

        <div className="flex flex-col gap-2 rounded-lg border border-l-4 border-border border-l-emerald-500 bg-card p-4">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Acreditaciones vigentes</span>
            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          </div>
          {data.acreditacionesPorCliente.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin clientes cargados.</p>
          ) : (
            <ul className="-mx-1.5 flex flex-col">
              {data.acreditacionesPorCliente.map((c) => (
                <li key={c.clientId}>
                  <button
                    type="button"
                    onClick={() =>
                      aplicar('requisitos', {
                        tipo: 'ACREDITACION',
                        habilitante: '1',
                        cliente: c.clientId,
                      })
                    }
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Ver acreditaciones vigentes ante ${c.clientName}`}
                  >
                    <span className="truncate">{c.clientName}</span>
                    <span className="font-semibold tabular-nums">{c.personas}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-auto text-xs text-muted-foreground">
            Personas habilitadas hoy, por cliente.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col rounded-lg border border-border bg-card lg:col-span-2">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ListChecks className="size-4 opacity-70" aria-hidden />
                Atender primero
              </h3>
              <p className="text-xs text-muted-foreground">
                Lo vencido primero y después lo que vence antes.
              </p>
            </div>
            {data.atender.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => aplicar('requisitos', { vigencia: 'VENCIDO,POR_VENCER' })}
              >
                Ver todo
                <ArrowRight className="ml-1 size-4" aria-hidden />
              </Button>
            )}
          </header>
          {data.atender.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {requisitos.total === 0
                ? 'Todavía no hay requisitos cargados. Se cargan desde la ficha de cada trabajador, en el Directorio.'
                : `Nada vencido ni por vencer en los próximos ${data.diasPorVencer} días.`}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.atender.map((r) => {
                const tipo = TIPO_REQUISITO[r.tipo];
                const Icono = tipo.icon;
                return (
                  <li
                    key={r.key}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
                  >
                    <Icono className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {r.firstName} {r.lastName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tipo.label} · {r.nombre}
                        {r.faenas ? ` · ${r.faenas}` : ''} · vence {fechaCorta(r.expiresAt)}
                      </p>
                    </div>
                    <EtiquetaVigencia vigencia={r.vigencia} diasRestantes={r.diasRestantes} />
                    <Button size="sm" variant="outline" onClick={() => onAbrir(r.userId, tipo.tab)}>
                      Abrir ficha
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="size-4 opacity-70" aria-hidden />
              Antecedentes sin cargar
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Datos que faltan en las fichas. No son requisitos incumplidos.
            </p>
            <ul className="-mx-1.5 mt-2 flex flex-col">
              <FilaConteo
                etiqueta="Sin turno cargado"
                valor={data.completitud.sinTurno}
                onClick={() => aplicar('personas', { turno: 'SIN' })}
              />
              <FilaConteo
                etiqueta="Sin cargo declarado"
                valor={data.completitud.sinCargo}
                onClick={() => aplicar('personas', { sinCargo: '1' })}
              />
              <FilaConteo
                etiqueta="Registros sin fecha de vencimiento"
                valor={requisitos.sinFecha}
                onClick={() => aplicar('requisitos', { vigencia: 'SIN_FECHA' })}
              />
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Requisitos cargados</h3>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 font-medium">Tipo</th>
                    <th className="py-1 text-right font-medium">Total</th>
                    <th className="py-1 text-right font-medium">Vencidos</th>
                    <th className="py-1 text-right font-medium">Por vencer</th>
                  </tr>
                </thead>
                <tbody>
                  {data.porTipo.map((t) => (
                    <tr key={t.tipo} className="border-t border-border">
                      <td className="py-1.5">
                        <button
                          type="button"
                          onClick={() => aplicar('requisitos', { tipo: t.tipo })}
                          className="rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {TIPO_REQUISITO[t.tipo].plural}
                        </button>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{t.total}</td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${
                          t.vencidos > 0
                            ? 'font-semibold text-red-700 dark:text-red-300'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {t.vencidos}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${
                          t.porVencer > 0
                            ? 'font-semibold text-amber-700 dark:text-amber-300'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {t.porVencer}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Turnos data={data} aplicar={aplicar} />
        <Matriz data={data} aplicar={aplicar} />
      </div>
    </div>
  );
}

function Indicador({
  icon: Icon,
  titulo,
  valor,
  detalle,
  accion,
  tono = 'neutro',
  onClick,
}: {
  icon: LucideIcon;
  titulo: string;
  valor: number;
  detalle: string;
  accion: string;
  tono?: Tono;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col gap-1.5 rounded-lg border border-l-4 border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${TONO[tono].borde}`}
    >
      <span className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>{titulo}</span>
        <Icon className={`size-4 ${TONO[tono].icono}`} aria-hidden />
      </span>
      <span className="text-3xl font-semibold tabular-nums">{valor}</span>
      <span className="text-xs text-muted-foreground">{detalle}</span>
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
        {accion}
        <ArrowRight
          className="size-3 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </button>
  );
}

function FilaConteo({
  etiqueta,
  valor,
  onClick,
}: {
  etiqueta: string;
  valor: number;
  onClick: () => void;
}): ReactNode {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 rounded px-1.5 py-1.5 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{etiqueta}</span>
        <span className={`tabular-nums ${valor > 0 ? 'font-semibold' : 'text-muted-foreground'}`}>
          {valor}
        </span>
      </button>
    </li>
  );
}

function Turnos({
  data,
  aplicar,
}: {
  data: HrDashboard;
  aplicar: (modo: ModoConsulta, filtros: FiltrosConsulta) => void;
}): ReactNode {
  const max = Math.max(1, ...data.turnos.map((t) => t.personas));
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4 opacity-70" aria-hidden />
        Trabajadores por turno
      </h3>
      {data.turnos.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Sin trabajadores cargados.</p>
      ) : (
        <ul className="-mx-2 mt-2 flex flex-col">
          {data.turnos.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => aplicar('personas', { turno: t.key })}
                className="grid w-full grid-cols-[9rem_1fr_2.5rem] items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${t.label}: ${plural(t.personas, 'persona', 'personas')}. Ver listado`}
              >
                <span
                  className={`truncate text-sm ${t.key === 'SIN' ? 'italic text-muted-foreground' : ''}`}
                >
                  {t.label}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className={`block h-full rounded-full ${t.key === 'SIN' ? 'bg-slate-400 dark:bg-slate-500' : 'bg-primary'}`}
                    style={{ width: `${(t.personas / max) * 100}%` }}
                  />
                </span>
                <span className="text-right text-sm tabular-nums">{t.personas}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Habilitación por faena. Una inducción cuenta solo en las faenas donde se
 * marcó, y una acreditación sin faena cuenta en todas las de su cliente: la
 * misma regla que aplica la consulta al filtrar por faena.
 */
function Matriz({
  data,
  aplicar,
}: {
  data: HrDashboard;
  aplicar: (modo: ModoConsulta, filtros: FiltrosConsulta) => void;
}): ReactNode {
  const grupos = new Map<string, { clientName: string; filas: HrDashboard['matriz'] }>();
  for (const f of data.matriz) {
    const g = grupos.get(f.clientId) ?? { clientName: f.clientName, filas: [] };
    g.filas.push(f);
    grupos.set(f.clientId, g);
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <HardHat className="size-4 opacity-70" aria-hidden />
        Habilitación por faena
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Personas con acreditación y con inducción que habilitan hoy en cada faena.
      </p>
      {grupos.size === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Sin faenas cargadas.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Faena</th>
                <th className="py-1 text-right font-medium">Acreditados</th>
                <th className="py-1 text-right font-medium">Con inducción</th>
              </tr>
            </thead>
            {[...grupos.entries()].map(([clientId, g]) => (
              <tbody key={clientId}>
                <tr>
                  <th
                    colSpan={3}
                    scope="colgroup"
                    className="pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {g.clientName}
                  </th>
                </tr>
                {g.filas.map((f) => (
                  <tr key={f.faenaId} className="border-t border-border">
                    <td className="py-1.5">{f.faenaName}</td>
                    <td className="py-1 text-right">
                      <CeldaConteo
                        valor={f.acreditados}
                        etiqueta={`Ver acreditados en ${f.faenaName}`}
                        onClick={() =>
                          aplicar('requisitos', {
                            cliente: f.clientId,
                            faena: f.faenaId,
                            tipo: 'ACREDITACION',
                            habilitante: '1',
                          })
                        }
                      />
                    </td>
                    <td className="py-1 text-right">
                      <CeldaConteo
                        valor={f.inducidos}
                        etiqueta={`Ver inducciones válidas en ${f.faenaName}`}
                        onClick={() =>
                          aplicar('requisitos', {
                            cliente: f.clientId,
                            faena: f.faenaId,
                            tipo: 'INDUCCION',
                            habilitante: '1',
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}

function CeldaConteo({
  valor,
  etiqueta,
  onClick,
}: {
  valor: number;
  etiqueta: string;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${etiqueta}: ${valor}`}
      className={`min-w-10 rounded px-2 py-0.5 tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        valor > 0 ? 'font-semibold' : 'text-muted-foreground'
      }`}
    >
      {valor}
    </button>
  );
}
