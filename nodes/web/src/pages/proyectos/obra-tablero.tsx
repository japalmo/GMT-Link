import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Flag, TrendingDown, TrendingUp, Minus, MapPin, Layers, Activity } from 'lucide-react';
import type {
  ObraBreakdown,
  ObraCurvePoint,
  ObraDashboard,
  ObraLine,
  ObraMilestone,
  ObraRecentReport,
  ObraStatus,
} from '@gmt-platform/contracts';

/**
 * Tablero de avance de obra en UNA pantalla, sin scroll: entra completo en la
 * TV de faena y en un notebook. Lo que no cabe se muestra por turnos, con
 * paneles que rotan solos, porque nadie va a tocar la pantalla de la faena.
 *
 * En móvil el tablero deja de ser fijo y pasa a scroll: forzar una pantalla
 * ahí dejaría los números ilegibles.
 */

// Cada panel se queda este tiempo. 13 s alcanza para leer un panel completo sin
// que quien pasa frente a la TV tenga que esperar demasiado por el que le importa.
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

const ESTADO: Record<
  ObraStatus,
  { label: string; clase: string; punto: string; Icon: typeof TrendingUp }
> = {
  ADELANTADO: {
    label: 'Adelantado',
    clase: 'text-emerald-600 dark:text-emerald-400',
    punto: 'bg-emerald-500',
    Icon: TrendingUp,
  },
  EN_LINEA: {
    label: 'En línea',
    clase: 'text-sky-600 dark:text-sky-400',
    punto: 'bg-sky-500',
    Icon: Minus,
  },
  LEVE_ATRASO: {
    label: 'Leve atraso',
    clase: 'text-amber-600 dark:text-amber-400',
    punto: 'bg-amber-500',
    Icon: TrendingDown,
  },
  ATRASADO: {
    label: 'Atrasado',
    clase: 'text-rose-600 dark:text-rose-400',
    punto: 'bg-rose-500',
    Icon: TrendingDown,
  },
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
 * Número que sube hasta su valor. Da la sensación de dato vivo y, sobre todo,
 * hace evidente que la cifra cambió cuando la pantalla se refresca sola.
 */
function useConteo(valor: number, activo: boolean): number {
  const [mostrado, setMostrado] = useState(activo ? 0 : valor);
  const anterior = useRef(activo ? 0 : valor);

  useEffect(() => {
    // `requestAnimationFrame` no corre en una pestaña oculta: sin esta salida,
    // una TV que arranca con la pestaña en segundo plano se quedaría mostrando
    // 0% hasta que alguien la traiga al frente. El dato correcto manda sobre
    // la animación.
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
      // Desaceleración: arranca rápido y frena al llegar, como un cuentakilómetros.
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
  /** `true` bloquea el alto a una pantalla (TV). `false` deja fluir el contenido. */
  fijo?: boolean;
}): ReactNode {
  const quieto = usaMenosMovimiento();
  const paneles = useMemo(() => construirPaneles(data), [data]);
  const [turno, setTurno] = useState(0);

  // La rotación se reinicia si cambia la cantidad de paneles, para no quedar
  // apuntando a un índice que ya no existe.
  useEffect(() => {
    setTurno(0);
  }, [paneles.length]);

  useEffect(() => {
    if (paneles.length < 2) return;
    const id = window.setInterval(
      () => setTurno((t) => (t + 1) % paneles.length),
      TURNO_MS,
    );
    return () => window.clearInterval(id);
  }, [paneles.length]);

  const actual = paneles[Math.min(turno, paneles.length - 1)];

  return (
    <div
      className={
        fijo
          ? 'flex flex-col gap-3 md:h-full md:min-h-0 md:gap-4'
          : 'flex flex-col gap-3 md:gap-4'
      }
    >
      <Indicadores data={data} quieto={quieto} />

      <section
        className={`flex min-h-0 flex-col rounded-xl border border-border bg-card ${
          fijo ? 'md:flex-1' : ''
        }`}
        aria-live="polite"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-2.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold sm:text-base">
            {actual?.Icon && <actual.Icon className="size-4 text-primary" aria-hidden />}
            {actual?.titulo}
          </h2>
          <Turnos total={paneles.length} activo={turno} quieto={quieto} onIr={setTurno} />
        </header>

        {/* La `key` fuerza el remontaje: cada panel entra animándose de nuevo. */}
        <div
          key={actual?.id}
          className={`min-h-0 flex-1 px-4 py-3 sm:px-5 sm:py-4 ${quieto ? '' : 'animate-panel'}`}
        >
          {actual?.contenido}
        </div>
      </section>
    </div>
  );
}

/** Puntos de la rotación. Se pueden tocar para saltar a un panel. */
function Turnos({
  total,
  activo,
  quieto,
  onIr,
}: {
  total: number;
  activo: number;
  quieto: boolean;
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
          className={`h-1.5 rounded-full transition-all ${
            i === activo ? 'w-7 bg-primary' : 'w-1.5 bg-border hover:bg-muted-foreground/40'
          }`}
        >
          {i === activo && !quieto && (
            <span className="block h-full w-full origin-left animate-turno rounded-full bg-primary/40" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Fila de indicadores ──────────────────────────────────────────────────────

function Indicadores({ data, quieto }: { data: ObraDashboard; quieto: boolean }): ReactNode {
  const est = ESTADO[data.status];
  const dev = data.deviation;
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <div className="col-span-2 flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 md:col-span-1">
        <Gauge real={data.realProgress} planned={data.plannedProgress} quieto={quieto} />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Avance real</p>
          <p className="text-xs text-muted-foreground">
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
        valor={dev}
        sufijo=" pp"
        signo
        pie="Real menos planificado"
        clase={est.clase}
        quieto={quieto}
      />

      <div className="flex flex-col justify-center rounded-xl border border-border bg-card px-4 py-3">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Estado</span>
        <span className={`mt-0.5 flex items-center gap-2 text-xl font-bold md:text-2xl ${est.clase}`}>
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
        <span className="mt-0.5 truncate text-xs text-muted-foreground">
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
  clase = 'text-foreground',
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
    <div className="flex flex-col justify-center rounded-xl border border-border bg-card px-4 py-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</span>
      <span className={`mt-0.5 text-2xl font-bold tabular-nums md:text-4xl ${clase}`}>{texto}</span>
      <span className="mt-0.5 truncate text-xs text-muted-foreground">{pie}</span>
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
  // Solo se usan 3/4 de la circunferencia: el hueco de abajo deja respirar el
  // número y evita que el arco se confunda con un anillo cerrado al 100%.
  const ARCO = CIRC * 0.75;
  const mostrado = useConteo(real, !quieto);
  const avance = Math.min(100, Math.max(0, mostrado));
  const marca = Math.min(100, Math.max(0, planned));

  return (
    <div className="relative shrink-0">
      <svg
        viewBox="0 0 120 120"
        className="size-[92px] -rotate-[135deg] md:size-[104px]"
        role="img"
        aria-label={`Avance real ${real}% contra ${planned}% planificado`}
      >
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className="stroke-muted"
          strokeDasharray={`${ARCO} ${CIRC}`}
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={`${(ARCO * avance) / 100} ${CIRC}`}
        />
        {/* Marca del programa: dónde debería ir la obra hoy. */}
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="12"
          className="stroke-amber-500"
          strokeDasharray={`2 ${CIRC}`}
          strokeDashoffset={-(ARCO * marca) / 100}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums md:text-2xl">
        {mostrado.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
      </span>
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
            (f) => `${f.activities.length} ${f.activities.length === 1 ? 'actividad' : 'actividades'}`,
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

// ── Panel: curva S ───────────────────────────────────────────────────────────

function CurvaS({ curves }: { curves: ObraDashboard['curves'] }): ReactNode {
  const W = 1000;
  const H = 320;
  const PAD = { top: 14, right: 20, bottom: 26, left: 44 };
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

  const ejeX = [minT, minT + spanT / 3, minT + (2 * spanT) / 3, maxT];
  const isoDe = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ultimo = curves.real[curves.real.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="min-h-[150px] w-full flex-1"
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
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.left - 8}
              y={y(g) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {g}%
            </text>
          </g>
        ))}

        {banda && <polygon points={banda} className="fill-primary/10" />}

        {curves.late.length > 0 && (
          <polyline
            points={linea(curves.late)}
            fill="none"
            className="stroke-muted-foreground/50"
            strokeWidth={1.5}
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {curves.early.length > 0 && (
          <polyline
            points={linea(curves.early)}
            fill="none"
            className="stroke-muted-foreground/50"
            strokeWidth={1.5}
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {curves.scheduled.length > 0 && (
          <polyline
            points={linea(curves.scheduled)}
            fill="none"
            className="stroke-amber-500"
            strokeWidth={2.5}
            strokeDasharray="7 5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {curves.real.length > 0 && (
          <polyline
            points={linea(curves.real)}
            fill="none"
            className="animate-trazo stroke-primary"
            strokeWidth={3.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {ultimo && (
          <circle cx={x(ultimo.date)} cy={y(ultimo.value)} r={6} className="fill-primary" />
        )}

        {ejeX.map((t, i) => (
          <text
            key={t}
            x={PAD.left + ((t - minT) / spanT) * plotW}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === ejeX.length - 1 ? 'end' : 'middle'}
            className="fill-muted-foreground text-[11px]"
          >
            {fechaCorta(isoDe(t))}
          </text>
        ))}
      </svg>

      <div className="mt-2 flex shrink-0 flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <Leyenda color="bg-primary" texto="Real ejecutado" />
        <Leyenda punteado="border-amber-500" texto="Programa vigente" />
        <Leyenda bloque="bg-primary/10" texto="Margen entre inicio temprano y tardío" />
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
      {color && <span className={`h-1 w-5 rounded ${color}`} aria-hidden />}
      {punteado && <span className={`h-0 w-5 border-t-2 border-dashed ${punteado}`} aria-hidden />}
      {bloque && <span className={`h-3 w-5 rounded-sm ${bloque}`} aria-hidden />}
      {texto}
    </span>
  );
}

// ── Panel: barras ────────────────────────────────────────────────────────────

function Barras({ lineas, detalle }: { lineas: ObraLine[]; detalle?: string[] }): ReactNode {
  if (lineas.length === 0) return <Vacio mensaje="Sin datos para este corte." />;
  return (
    <ul className="flex h-full min-h-0 flex-col justify-around gap-1.5 overflow-y-auto">
      {lineas.map((l, i) => (
        <li key={l.id} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium sm:text-base">{l.name}</span>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
              {detalle?.[i] ??
                l.detail ??
                `${cantidad(l.quantityDone)} / ${cantidad(l.quantityTotal)}${l.unit ? ` ${l.unit}` : ''}`}
            </span>
            <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums sm:text-base">
              {l.percent.toLocaleString('es-CL')}%
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full animate-barra rounded-full bg-primary"
              style={
                {
                  '--barra': `${Math.min(100, Math.max(0, l.percent))}%`,
                  animationDelay: `${i * 60}ms`,
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
          className="flex animate-entrada items-center gap-3"
          style={{ animationDelay: `${i * 70}ms` } as React.CSSProperties}
        >
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
              h.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'
            }`}
            aria-hidden
          >
            {h.done && <Flag className="size-3" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium sm:text-base">{h.name}</span>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {fechaLarga(h.date)}
          </span>
          <span
            className={`w-20 shrink-0 text-right text-xs font-semibold ${
              h.done ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {h.done ? 'Cumplido' : 'Pendiente'}
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
          className="flex animate-entrada items-center gap-3 text-sm"
          style={{ animationDelay: `${i * 60}ms` } as React.CSSProperties}
        >
          <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
            {fechaLarga(r.date)}
          </span>
          <span className="min-w-0 flex-1 truncate">{r.activityName}</span>
          <span className="shrink-0 font-semibold tabular-nums text-primary">
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
    <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
      {mensaje}
    </p>
  );
}
