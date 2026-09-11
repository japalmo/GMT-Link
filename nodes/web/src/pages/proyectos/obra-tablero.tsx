import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Flag,
  Layers,
  MapPin,
  Minus,
  Pin,
  PinOff,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  ObraBreakdown,
  ObraCurvePoint,
  ObraDashboard,
  ObraLine,
  ObraMapPoint,
  ObraMilestone,
  ObraRecentReport,
  ObraStatus,
} from '@gmt-platform/contracts';
import {
  COLOR_ESTADO,
  NOMBRE_ESTADO,
  ObraMapa,
  SIN_FILTRO,
  pasaFiltro,
  type ControlesMapa,
  type FiltroMapa,
} from './obra-mapa';
import { useDisposicion } from './usar-arrastre';
import { Arrastrable, ControlesTablero, PanelClima } from './obra-piezas';

/**
 * Tablero de avance de obra: el mapa satelital de la faena es el FONDO y todo
 * lo demás flota encima en vidrio. Entra completo en una pantalla de TV y de
 * notebook; en móvil se apila, porque comprimirlo ahí dejaría los números
 * ilegibles.
 *
 * Los paneles rotan solos y cualquiera se puede FIJAR: en una reunión uno se
 * queda mirando la curva, no espera a que vuelva.
 */

// Cada dupla se queda este tiempo. 13 s alcanza para leerla sin que quien pasa
// frente a la TV espere demasiado por la que le importa.
const TURNO_MS = 13_000;

// ── Formato ──────────────────────────────────────────────────────────────────

/**
 * Fecha ISO (aaaa-mm-dd) a dd-mm-aaaa SIN pasar por `Date`: construir un Date
 * con "2026-09-10" lo interpreta como medianoche UTC y en Chile mostraría el 9.
 */
export function fechaLarga(iso: string | null): string {
  if (!iso) return 'Sin fecha';
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}-${m}-${a}` : iso;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  if (!a || !m || !d) return iso;
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

function cantidad(n: number): string {
  return n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
}

/** Semáforo sobre vidrio oscuro: los tonos del tema no contrastan ahí. */
const ESTADO: Record<
  ObraStatus,
  { label: string; clase: string; punto: string; Icon: typeof TrendingUp }
> = {
  ADELANTADO: { label: 'Adelantado', clase: 'text-emerald-300', punto: 'bg-emerald-400', Icon: TrendingUp },
  EN_LINEA: { label: 'En línea', clase: 'text-sky-300', punto: 'bg-sky-400', Icon: Minus },
  LEVE_ATRASO: { label: 'Leve atraso', clase: 'text-amber-300', punto: 'bg-amber-400', Icon: TrendingDown },
  ATRASADO: { label: 'Atrasado', clase: 'text-rose-300', punto: 'bg-rose-400', Icon: TrendingDown },
};

// ── Animación ────────────────────────────────────────────────────────────────

/** ¿El visor pidió menos movimiento? Entonces nada se anima, solo aparece. */
function usaMenosMovimiento(): boolean {
  const [reducido, setReducido] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducido(mq.matches);
    const cambio = (e: MediaQueryListEvent) => setReducido(e.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  return reducido;
}

/**
 * Número que sube hasta su valor. Da sensación de dato vivo y hace evidente
 * que la cifra cambió cuando la pantalla se refresca sola.
 */
function useConteo(valor: number, activo: boolean): number {
  const [mostrado, setMostrado] = useState(activo ? 0 : valor);
  const anterior = useRef(activo ? 0 : valor);

  useEffect(() => {
    // `requestAnimationFrame` no corre en una pestaña oculta: sin esta salida,
    // una TV que arranca en segundo plano se quedaría mostrando 0%. El dato
    // correcto manda sobre la animación.
    if (!activo || document.hidden) {
      setMostrado(valor);
      anterior.current = valor;
      return;
    }
    const desde = anterior.current;
    const inicio = performance.now();
    const DURACION = 900;
    let frame = 0;
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / DURACION);
      const suave = 1 - (1 - t) ** 3;
      setMostrado(desde + (valor - desde) * suave);
      if (t < 1) frame = requestAnimationFrame(paso);
      else anterior.current = valor;
    };
    frame = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(frame);
  }, [valor, activo]);

  return mostrado;
}

// ── Tablero ──────────────────────────────────────────────────────────────────

export function ObraTablero({
  data,
  fijo = true,
}: {
  data: ObraDashboard;
  /** `true` ocupa el alto que le den (TV). `false` usa un alto propio. */
  fijo?: boolean;
}): ReactNode {
  const quieto = usaMenosMovimiento();
  const [filtro, setFiltro] = useState<FiltroMapa>(SIN_FILTRO);
  const [controles, setControles] = useState<ControlesMapa | null>(null);
  // La disposición se guarda por proyecto: mover los paneles de una obra no
  // debe descolocar los de la siguiente.
  const { posiciones, mover, reiniciar, movido } = useDisposicion(data.projectId);
  const paneles = useMemo(() => construirPaneles(data), [data]);
  const duplas = useMemo(() => emparejar(paneles), [paneles]);
  const [turno, setTurno] = useState(0);
  const [fijada, setFijada] = useState<number | null>(null);

  useEffect(() => {
    setTurno(0);
    setFijada(null);
  }, [duplas.length]);

  useEffect(() => {
    if (duplas.length < 2 || fijada !== null) return;
    const id = window.setInterval(() => setTurno((t) => (t + 1) % duplas.length), TURNO_MS);
    return () => window.clearInterval(id);
  }, [duplas.length, fijada]);

  const indice = fijada ?? Math.min(turno, duplas.length - 1);
  const actual = duplas[indice] ?? [];
  const hayFiltro = filtro.estados.length > 0 || filtro.tipos.length > 0 || filtro.sector !== null;
  const visibles = data.map.points.filter((p) => pasaFiltro(p, filtro)).length;
  const conMapa = data.map.points.length > 0;

  const irA = (i: number) => {
    setTurno(i);
    if (fijada !== null) setFijada(i);
  };

  const tarjetas = actual.map((panel) => (
    <TarjetaPanel
      key={panel.id}
      panel={panel}
      quieto={quieto}
      total={duplas.length}
      indice={indice}
      fijada={fijada !== null}
      onIr={irA}
      onFijar={() => setFijada((f) => (f === null ? indice : null))}
    />
  ));

  const leyenda = conMapa ? (
    <LeyendaFiltros
      puntos={data.map.points}
      visibles={visibles}
      sinUbicar={data.map.unlocated}
      filtro={filtro}
      onFiltro={setFiltro}
      hayFiltro={hayFiltro}
    />
  ) : null;

  /*
   * Dos layouts, no uno con parches. De `lg` para arriba el mapa es el fondo y
   * el resto flota encima: es la vista de TV. Más abajo se apila en orden
   * normal, porque en una pantalla angosta el vidrio flotante se encabalga y
   * queda ilegible.
   */
  return (
    <div
      className={`flex flex-col gap-2 lg:relative lg:isolate lg:gap-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-white/10 lg:bg-slate-900 ${
        fijo ? 'lg:h-full lg:min-h-[560px]' : 'lg:h-[78vh]'
      }`}
    >
      {conMapa && (
        <div className="relative h-[280px] shrink-0 overflow-hidden rounded-xl border border-white/10 sm:h-[340px] lg:absolute lg:inset-0 lg:h-auto lg:rounded-none lg:border-0">
          <ObraMapa mapa={data.map} filtro={filtro} onControles={setControles} />
          {/* Velo: el terreno de Mantos Blancos es arena clara y el vidrio
              necesita fondo para que el texto blanco se lea también sobre las
              zonas planas. */}
          <div
            className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-br from-slate-950/50 via-slate-950/15 to-slate-950/50"
            aria-hidden
          />
        </div>
      )}

      {/* Capa de contenido. Sobre el mapa no captura el puntero salvo en las
          tarjetas, para que el mapa se arrastre por los huecos. */}
      <div className="flex flex-col gap-2 sm:gap-3 lg:pointer-events-none lg:absolute lg:inset-0 lg:z-20 lg:p-3">
        <Arrastrable id="indicadores" posiciones={posiciones} onMover={mover} asaCompleta>
          <Indicadores data={data} quieto={quieto} />
        </Arrastrable>

        <div className="flex flex-col gap-2 sm:gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
          <div className="order-2 flex flex-col gap-2 sm:gap-3 lg:order-1 lg:w-[264px] lg:shrink-0 lg:justify-between lg:overflow-y-auto lg:pr-1">
            {data.weather && (
              <Arrastrable id="clima" posiciones={posiciones} onMover={mover}>
                <PanelClima weather={data.weather} />
              </Arrastrable>
            )}
            {leyenda && (
              <Arrastrable id="leyenda" posiciones={posiciones} onMover={mover}>
                {leyenda}
              </Arrastrable>
            )}
          </div>

          {/* Hueco por el que se ve el mapa; abajo van los controles del mapa. */}
          <div className="hidden flex-1 flex-col items-center justify-end lg:flex">
            {conMapa && (
              <ControlesTablero
                controles={controles}
                movido={movido}
                onReiniciar={reiniciar}
              />
            )}
          </div>

          <div className="order-1 flex flex-col gap-2 sm:gap-3 lg:order-2 lg:min-h-0 lg:w-[440px] lg:flex-none">
            <Arrastrable id="tarjetas" posiciones={posiciones} onMover={mover} columna>
              {tarjetas}
            </Arrastrable>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Una tarjeta de vidrio con su panel adentro. */
function TarjetaPanel({
  panel,
  quieto,
  total,
  indice,
  fijada,
  onIr,
  onFijar,
}: {
  panel: Panel;
  quieto: boolean;
  total: number;
  indice: number;
  fijada: boolean;
  onIr: (i: number) => void;
  onFijar: () => void;
}): ReactNode {
  return (
    <section className="vidrio flex h-[230px] flex-col overflow-hidden rounded-xl lg:pointer-events-auto lg:h-auto lg:min-h-[200px] lg:flex-1">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold lg:text-base">
          <panel.Icon className="size-4 shrink-0 opacity-80" aria-hidden />
          <span className="truncate">{panel.titulo}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <Turnos total={total} activo={indice} quieto={quieto} corriendo={!fijada} onIr={onIr} />
          <button
            type="button"
            onClick={onFijar}
            aria-pressed={fijada}
            title={fijada ? 'Volver a rotar' : 'Fijar esta vista'}
            className={`rounded-md p-1 transition-colors ${
              fijada ? 'bg-white text-slate-900' : 'text-white/70 hover:bg-white/15 hover:text-white'
            }`}
          >
            {fijada ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            <span className="sr-only">{fijada ? 'Volver a rotar' : 'Fijar esta vista'}</span>
          </button>
        </div>
      </header>

      {/* La `key` fuerza el remontaje: cada panel entra animándose. */}
      <div key={panel.id} className={`min-h-0 flex-1 px-3 py-2.5 ${quieto ? '' : 'animate-panel'}`}>
        {panel.contenido}
      </div>
    </section>
  );
}

/** Puntos de la rotación. Se pueden tocar para saltar a una dupla. */
function Turnos({
  total,
  activo,
  quieto,
  corriendo,
  onIr,
}: {
  total: number;
  activo: number;
  quieto: boolean;
  corriendo: boolean;
  onIr: (i: number) => void;
}): ReactNode {
  if (total < 2) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onIr(i)}
          aria-label={`Ver panel ${i + 1} de ${total}`}
          aria-current={i === activo}
          className={`h-1.5 overflow-hidden rounded-full transition-all ${
            i === activo ? 'w-7 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'
          }`}
        >
          {i === activo && !quieto && corriendo && (
            <span className="block h-full w-full origin-left animate-turno rounded-full bg-white/50" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Fila de indicadores ──────────────────────────────────────────────────────

function Indicadores({ data, quieto }: { data: ObraDashboard; quieto: boolean }): ReactNode {
  const est = ESTADO[data.status];
  return (
    <div className="pointer-events-auto grid shrink-0 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <div className="vidrio col-span-2 flex items-center gap-3 rounded-xl px-3 py-2.5 lg:col-span-1">
        <Gauge real={data.realProgress} planned={data.plannedProgress} quieto={quieto} />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-white/60 lg:text-xs">Avance real</p>
          <p className="text-xs text-white/80 lg:text-sm">
            Programa {data.plannedProgress.toLocaleString('es-CL')}%
          </p>
        </div>
      </div>

      <Indicador
        etiqueta="Planificado"
        valor={data.plannedProgress}
        sufijo="%"
        pie={`Al ${fechaLarga(data.asOf)}`}
        quieto={quieto}
      />
      <Indicador
        etiqueta="Desviación"
        valor={data.deviation}
        sufijo=" pp"
        signo
        pie="Real menos planificado"
        clase={est.clase}
        quieto={quieto}
      />

      <div className="vidrio flex flex-col justify-center rounded-xl px-3 py-2.5">
        <span className="text-[10px] uppercase tracking-wide text-white/60 lg:text-xs">Estado</span>
        <span className={`mt-0.5 flex items-center gap-2 text-xl font-bold lg:text-3xl ${est.clase}`}>
          <span className="relative flex size-2.5" aria-hidden>
            {!quieto && (
              <span
                className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${est.punto}`}
              />
            )}
            <span className={`relative inline-flex size-2.5 rounded-full ${est.punto}`} />
          </span>
          {est.label}
        </span>
        <span className="mt-0.5 truncate text-[11px] text-white/70 lg:text-xs">
          {fechaLarga(data.programStart)} al {fechaLarga(data.programEnd)}
        </span>
      </div>
    </div>
  );
}

function Indicador({
  etiqueta,
  valor,
  sufijo,
  pie,
  clase = 'text-white',
  signo = false,
  quieto,
}: {
  etiqueta: string;
  valor: number;
  sufijo: string;
  pie: string;
  clase?: string;
  signo?: boolean;
  quieto: boolean;
}): ReactNode {
  const mostrado = useConteo(valor, !quieto);
  const texto = `${signo && mostrado > 0 ? '+' : ''}${mostrado.toLocaleString('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}${sufijo}`;
  return (
    <div className="vidrio flex flex-col justify-center rounded-xl px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-wide text-white/60 lg:text-xs">{etiqueta}</span>
      <span className={`mt-0.5 text-2xl font-bold tabular-nums lg:text-4xl xl:text-5xl ${clase}`}>{texto}</span>
      <span className="mt-0.5 truncate text-[11px] text-white/70 lg:text-xs">{pie}</span>
    </div>
  );
}

// ── Gauge ────────────────────────────────────────────────────────────────────

function Gauge({
  real,
  planned,
  quieto,
}: {
  real: number;
  planned: number;
  quieto: boolean;
}): ReactNode {
  const R = 46;
  const CIRC = 2 * Math.PI * R;
  // Solo 3/4 de la circunferencia: el hueco de abajo deja respirar el número.
  const ARCO = CIRC * 0.75;
  const mostrado = useConteo(real, !quieto);
  const avance = Math.min(100, Math.max(0, mostrado));
  const marca = Math.min(100, Math.max(0, planned));

  return (
    <div className="relative shrink-0">
      <svg
        viewBox="0 0 120 120"
        className="size-[76px] -rotate-[135deg] lg:size-[96px]"
        role="img"
        aria-label={`Avance real ${real}% contra ${planned}% planificado`}
      >
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          stroke="rgb(255 255 255 / 0.18)"
          strokeDasharray={`${ARCO} ${CIRC}`}
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          stroke="#38bdf8"
          strokeDasharray={`${(ARCO * avance) / 100} ${CIRC}`}
        />
        {/* Marca del programa: dónde debería ir la obra hoy. */}
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="13"
          stroke="#fbbf24"
          strokeDasharray={`2 ${CIRC}`}
          strokeDashoffset={-(ARCO * marca) / 100}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-bold tabular-nums lg:text-xl">
        {mostrado.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
      </span>
    </div>
  );
}

// ── Leyenda y filtros del mapa ───────────────────────────────────────────────

/** La leyenda ES el filtro: cada fila explica un color y además lo aísla. */
function LeyendaFiltros({
  puntos,
  visibles,
  sinUbicar,
  filtro,
  onFiltro,
  hayFiltro,
}: {
  puntos: ObraMapPoint[];
  visibles: number;
  sinUbicar: number;
  filtro: FiltroMapa;
  onFiltro: (f: FiltroMapa) => void;
  hayFiltro: boolean;
}): ReactNode {
  const cuenta = (fn: (p: ObraMapPoint) => boolean) => puntos.filter(fn).length;
  const sectores = [...new Set(puntos.map((p) => p.sector ?? 'Sin sector'))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
  const tipos = [...new Set(puntos.map((p) => p.workType))].sort();

  function alternar<T>(lista: T[], valor: T): T[] {
    return lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];
  }

  return (
    <div className="vidrio flex flex-col gap-1.5 rounded-xl px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide lg:text-sm">
          <MapPin className="size-3.5 opacity-80" aria-hidden />
          Cercos en faena
        </h3>
        <span className="text-xs tabular-nums text-white/70 lg:text-sm">
          {visibles} de {puntos.length}
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {(['TERMINADO', 'EN_EJECUCION', 'PENDIENTE'] as const).map((estado) => {
          const activo = filtro.estados.includes(estado);
          return (
            <li key={estado}>
              <button
                type="button"
                onClick={() => onFiltro({ ...filtro, estados: alternar(filtro.estados, estado) })}
                aria-pressed={activo}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-xs transition-colors lg:text-sm ${
                  activo ? 'vidrio-activo' : 'hover:bg-white/10'
                }`}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-white/70"
                  style={{ backgroundColor: COLOR_ESTADO[estado] }}
                  aria-hidden
                />
                <span className="flex-1 text-left">{NOMBRE_ESTADO[estado]}</span>
                <span className="font-semibold tabular-nums">{cuenta((p) => p.status === estado)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1 border-t border-white/10 pt-1.5">
        <span className="text-[10px] uppercase tracking-wide text-white/55 lg:text-xs">
          Tipo, la letra del punto
        </span>
        <div className="flex flex-wrap gap-1.5">
          {tipos.map((tipo) => {
            const activo = filtro.tipos.includes(tipo);
            return (
              <button
                key={tipo}
                type="button"
                onClick={() => onFiltro({ ...filtro, tipos: alternar(filtro.tipos, tipo) })}
                aria-pressed={activo}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors lg:text-sm ${
                  activo ? 'vidrio-activo' : 'vidrio-sutil hover:bg-white/20'
                }`}
              >
                {tipo}
                <span className="ml-1.5 font-normal tabular-nums opacity-70">
                  {cuenta((p) => p.workType === tipo)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="filtro-sector" className="text-[10px] uppercase tracking-wide text-white/55 lg:text-xs">
          Sector
        </label>
        <select
          id="filtro-sector"
          value={filtro.sector ?? ''}
          onChange={(e) => onFiltro({ ...filtro, sector: e.target.value || null })}
          className="vidrio-sutil flex-1 rounded-md px-2 py-1 text-xs text-white outline-none lg:text-sm [&>option]:bg-slate-800 [&>option]:text-white"
        >
          <option value="">Todos</option>
          {sectores.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {hayFiltro && (
        <button
          type="button"
          onClick={() => onFiltro(SIN_FILTRO)}
          className="flex items-center justify-center gap-1.5 rounded-md bg-white/15 px-2 py-1 text-xs transition-colors hover:bg-white/25"
        >
          <X className="size-3" aria-hidden />
          Quitar filtros
        </button>
      )}

      {sinUbicar > 0 && (
        <p className="text-[11px] leading-tight text-white/55 lg:text-xs">
          {sinUbicar} cercos aún sin ubicación confirmada.
        </p>
      )}
    </div>
  );
}

// ── Paneles ──────────────────────────────────────────────────────────────────

interface Panel {
  id: string;
  titulo: string;
  Icon: typeof Activity;
  contenido: ReactNode;
}

const ICONO_CORTE: Record<ObraBreakdown['key'], typeof Activity> = {
  etapa: Layers,
  tipo: Layers,
  sector: MapPin,
};

function construirPaneles(data: ObraDashboard): Panel[] {
  const paneles: Panel[] = [
    {
      id: 'curva',
      titulo: 'Curva S de avance',
      Icon: Activity,
      contenido: <CurvaS curves={data.curves} />,
    },
  ];

  for (const corte of data.breakdowns) {
    if (corte.lines.length === 0) continue;
    paneles.push({
      id: `corte-${corte.key}`,
      titulo: corte.label,
      Icon: ICONO_CORTE[corte.key] ?? Layers,
      contenido: <Barras lineas={corte.lines} />,
    });
  }

  if (data.phases.length > 0) {
    paneles.push({
      id: 'fases',
      titulo: 'Avance por fase',
      Icon: Layers,
      contenido: (
        <Barras
          lineas={data.phases.map((f) => ({
            id: f.id,
            name: f.name,
            unit: null,
            quantityTotal: f.quantityTotal,
            quantityDone: f.quantityDone,
            percent: f.percent,
          }))}
          detalle={data.phases.map(
            (f) =>
              `${f.activities.length} ${f.activities.length === 1 ? 'actividad' : 'actividades'}`,
          )}
        />
      ),
    });
  }

  if (data.milestones.length > 0) {
    paneles.push({
      id: 'hitos',
      titulo: 'Hitos del contrato',
      Icon: Flag,
      contenido: <Hitos items={data.milestones} />,
    });
  }

  if (data.recent.length > 0) {
    paneles.push({
      id: 'avances',
      titulo: 'Últimos avances reportados',
      Icon: Activity,
      contenido: <Avances items={data.recent} />,
    });
  }

  return paneles;
}

/**
 * Arma las duplas que se muestran juntas. El orden no es mecánico: se junta lo
 * que se lee bien una sobre otra, y lo que sobre se empareja de a dos.
 */
function emparejar(paneles: Panel[]): Panel[][] {
  const porId = new Map(paneles.map((p) => [p.id, p]));
  const PREFERIDAS: Array<[string, string]> = [
    ['curva', 'hitos'],
    ['corte-etapa', 'avances'],
    ['corte-sector', 'corte-tipo'],
    ['fases', ''],
  ];

  const duplas: Panel[][] = [];
  const usados = new Set<string>();
  for (const [a, b] of PREFERIDAS) {
    const par = [porId.get(a), porId.get(b)].filter((x): x is Panel => !!x);
    if (par.length === 0) continue;
    par.forEach((x) => usados.add(x.id));
    duplas.push(par);
  }
  const sobrantes = paneles.filter((p) => !usados.has(p.id));
  for (let i = 0; i < sobrantes.length; i += 2) duplas.push(sobrantes.slice(i, i + 2));
  return duplas;
}

// ── Panel: curva S ───────────────────────────────────────────────────────────

function CurvaS({ curves }: { curves: ObraDashboard['curves'] }): ReactNode {
  const W = 620;
  const H = 300;
  const PAD = { top: 12, right: 14, bottom: 26, left: 38 };
  const todas = [...curves.early, ...curves.scheduled, ...curves.late, ...curves.real];
  if (todas.length === 0) {
    return <Vacio mensaje="Todavía no hay fechas programadas para dibujar la curva." />;
  }
  const tiempos = todas.map((p) => Date.parse(p.date));
  const minT = Math.min(...tiempos);
  const maxT = Math.max(...tiempos);
  const spanT = maxT - minT || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (iso: string) => PAD.left + ((Date.parse(iso) - minT) / spanT) * plotW;
  const y = (v: number) => PAD.top + (1 - v / 100) * plotH;
  const punto = (p: ObraCurvePoint) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`;
  const linea = (pts: ObraCurvePoint[]) => pts.map(punto).join(' ');

  const banda =
    curves.early.length > 0 && curves.late.length > 0
      ? `${linea(curves.early)} ${[...curves.late].reverse().map(punto).join(' ')}`
      : null;

  const ejeX = [minT, minT + spanT / 2, maxT];
  const isoDe = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ultimo = curves.real[curves.real.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* `meet`, no `none`: estirar el viewBox al contenedor aplastaba la curva
          y la dejaba ilegible. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-h-0 w-full flex-1"
        role="img"
        aria-label="Curva S: avance real contra el programa"
      >
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={PAD.left}
              y1={y(g)}
              x2={W - PAD.right}
              y2={y(g)}
              stroke="rgb(255 255 255 / 0.16)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(g) + 4}
              textAnchor="end"
              fill="rgb(255 255 255 / 0.6)"
              fontSize={11}
            >
              {g}%
            </text>
          </g>
        ))}

        {banda && <polygon points={banda} fill="rgb(56 189 248 / 0.16)" />}

        {curves.late.length > 0 && (
          <polyline
            points={linea(curves.late)}
            fill="none"
            stroke="rgb(255 255 255 / 0.35)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
        )}
        {curves.early.length > 0 && (
          <polyline
            points={linea(curves.early)}
            fill="none"
            stroke="rgb(255 255 255 / 0.35)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
        )}
        {curves.scheduled.length > 0 && (
          <polyline
            points={linea(curves.scheduled)}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2.5}
            strokeDasharray="7 5"
          />
        )}
        {curves.real.length > 0 && (
          <polyline
            points={linea(curves.real)}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={3.5}
            strokeLinejoin="round"
            className="animate-trazo"
          />
        )}
        {ultimo && <circle cx={x(ultimo.date)} cy={y(ultimo.value)} r={5} fill="#38bdf8" />}

        {ejeX.map((t, i) => (
          <text
            key={t}
            x={PAD.left + ((t - minT) / spanT) * plotW}
            y={H - 7}
            textAnchor={i === 0 ? 'start' : i === ejeX.length - 1 ? 'end' : 'middle'}
            fill="rgb(255 255 255 / 0.6)"
            fontSize={11}
          >
            {fechaCorta(isoDe(t))}
          </text>
        ))}
      </svg>

      <div className="mt-1 flex shrink-0 flex-wrap justify-center gap-x-4 gap-y-0.5 text-[11px] text-white/70 lg:text-xs">
        <Leyenda color="#38bdf8" texto="Real ejecutado" />
        <Leyenda punteado="#fbbf24" texto="Programa vigente" />
        <Leyenda bloque="rgb(56 189 248 / 0.3)" texto="Margen temprano-tardío" />
      </div>
    </div>
  );
}

function Leyenda({
  color,
  punteado,
  bloque,
  texto,
}: {
  color?: string;
  punteado?: string;
  bloque?: string;
  texto: string;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      {color && <span className="h-1 w-4 rounded" style={{ backgroundColor: color }} aria-hidden />}
      {punteado && (
        <span
          className="h-0 w-4 border-t-2 border-dashed"
          style={{ borderColor: punteado }}
          aria-hidden
        />
      )}
      {bloque && (
        <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: bloque }} aria-hidden />
      )}
      {texto}
    </span>
  );
}

// ── Panel: barras ────────────────────────────────────────────────────────────

function Barras({ lineas, detalle }: { lineas: ObraLine[]; detalle?: string[] }): ReactNode {
  if (lineas.length === 0) return <Vacio mensaje="Sin datos para este corte." />;
  return (
    <ul className="flex h-full min-h-0 flex-col justify-around gap-1 overflow-y-auto">
      {lineas.map((l, i) => (
        <li key={l.id} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium lg:text-sm">{l.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-white/60 lg:text-xs">
              {detalle?.[i] ??
                l.detail ??
                `${cantidad(l.quantityDone)} / ${cantidad(l.quantityTotal)}${
                  l.unit ? ` ${l.unit}` : ''
                }`}
            </span>
            <span className="w-11 shrink-0 text-right text-xs font-bold tabular-nums lg:w-14 lg:text-sm">
              {l.percent.toLocaleString('es-CL')}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full animate-barra rounded-full bg-sky-400"
              style={
                {
                  '--barra': `${Math.min(100, Math.max(0, l.percent))}%`,
                  animationDelay: `${i * 55}ms`,
                } as React.CSSProperties
              }
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Panel: hitos ─────────────────────────────────────────────────────────────

function Hitos({ items }: { items: ObraMilestone[] }): ReactNode {
  return (
    <ol className="flex h-full min-h-0 flex-col justify-around gap-1 overflow-y-auto">
      {items.map((h, i) => (
        <li
          key={h.id}
          className="flex animate-entrada items-center gap-2.5"
          style={{ animationDelay: `${i * 60}ms` } as React.CSSProperties}
        >
          <span
            className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
              h.done ? 'border-sky-400 bg-sky-400 text-slate-900' : 'border-white/35'
            }`}
            aria-hidden
          >
            {h.done && <Flag className="size-2.5" />}
          </span>
          <span className={`min-w-0 flex-1 truncate text-xs lg:text-sm ${h.done ? '' : 'text-white/70'}`}>
            {h.name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-white/60 lg:text-xs">
            {fechaLarga(h.date)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── Panel: últimos avances ───────────────────────────────────────────────────

function Avances({ items }: { items: ObraRecentReport[] }): ReactNode {
  return (
    <ul className="flex h-full min-h-0 flex-col justify-around gap-1 overflow-y-auto">
      {items.slice(0, 8).map((r, i) => (
        <li
          key={r.id}
          className="flex animate-entrada items-center gap-2 text-xs lg:text-sm"
          style={{ animationDelay: `${i * 50}ms` } as React.CSSProperties}
        >
          <span className="w-20 shrink-0 tabular-nums text-white/60 lg:w-24">{fechaLarga(r.date)}</span>
          <span className="min-w-0 flex-1 truncate">{r.activityName}</span>
          <span className="shrink-0 font-semibold tabular-nums text-sky-300">
            +{cantidad(r.quantity)}
            {r.unit ? ` ${r.unit}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Vacio({ mensaje }: { mensaje: string }): ReactNode {
  return (
    <p className="flex h-full items-center justify-center text-center text-xs text-white/60 lg:text-sm">
      {mensaje}
    </p>
  );
}
