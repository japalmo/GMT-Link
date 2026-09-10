import { useState, type ReactNode } from 'react';
import { Flag, TrendingDown, TrendingUp, Minus, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  ObraCurvePoint,
  ObraDashboard,
  ObraLine,
  ObraMilestone,
  ObraPhase,
  ObraStatus,
} from '@gmt-platform/contracts';

/**
 * Panel de avance de OBRA. Se usa igual dentro de la plataforma (pestaña del
 * proyecto) y en el enlace público que se proyecta en la TV de faena, para que
 * el cliente y el equipo vean exactamente lo mismo.
 *
 * `size="tv"` agranda tipografías y separa: la pantalla de faena se lee a tres
 * metros, no a medio metro.
 */

// ── Formato ──────────────────────────────────────────────────────────────────

/**
 * Fecha ISO (aaaa-mm-dd) a dd-mm-aaaa SIN pasar por `Date`. Construir un Date
 * con "2026-09-10" lo interpreta como medianoche UTC y en Chile lo mostraría
 * como el 9: acá se parte el string y listo.
 */
function fechaLarga(iso: string | null): string {
  if (!iso) return 'Sin fecha';
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}-${m}-${a}` : iso;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fecha ISO a "10 sep 26", para ejes y rieles donde no cabe el formato largo. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  if (!a || !m || !d) return iso;
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

/** Cantidades de obra: miles con punto y hasta un decimal, como en terreno. */
function cantidad(n: number): string {
  return n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
}

const ESTADO: Record<
  ObraStatus,
  { label: string; badge: 'success' | 'info' | 'warning' | 'danger'; Icon: typeof TrendingUp }
> = {
  ADELANTADO: { label: 'Adelantado', badge: 'success', Icon: TrendingUp },
  EN_LINEA: { label: 'En línea', badge: 'info', Icon: Minus },
  LEVE_ATRASO: { label: 'Leve atraso', badge: 'warning', Icon: TrendingDown },
  ATRASADO: { label: 'Atrasado', badge: 'danger', Icon: TrendingDown },
};

// ── Panel ────────────────────────────────────────────────────────────────────

export function ObraDashboardPanel({
  data,
  size = 'md',
}: {
  data: ObraDashboard;
  size?: 'md' | 'tv';
}): ReactNode {
  const tv = size === 'tv';
  return (
    <div className={tv ? 'flex flex-col gap-6' : 'flex flex-col gap-4'}>
      <KpiRow data={data} tv={tv} />

      <div className={`grid grid-cols-1 xl:grid-cols-3 ${tv ? 'gap-6' : 'gap-4'}`}>
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className={tv ? 'text-xl' : 'text-base'}>Curva S de avance</CardTitle>
          </CardHeader>
          <CardContent>
            <SCurve curves={data.curves} tv={tv} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className={tv ? 'text-xl' : 'text-base'}>Hitos del contrato</CardTitle>
          </CardHeader>
          <CardContent>
            <Milestones items={data.milestones} tv={tv} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className={tv ? 'text-xl' : 'text-base'}>Avance por fase</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {data.phases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              El proyecto todavía no tiene fases con actividades cargadas.
            </p>
          ) : (
            data.phases.map((f) => <PhaseRow key={f.id} phase={f} tv={tv} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Fila de indicadores ──────────────────────────────────────────────────────

function KpiRow({ data, tv }: { data: ObraDashboard; tv: boolean }): ReactNode {
  const est = ESTADO[data.status];
  const dev = data.deviation;
  const devColor =
    dev >= -1
      ? 'text-emerald-600 dark:text-emerald-400'
      : dev >= -5
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Avance real, con el gauge: es EL número de la obra */}
      <Card>
        <CardContent className="flex flex-col items-center py-5">
          <Gauge real={data.realProgress} planned={data.plannedProgress} tv={tv} />
        </CardContent>
      </Card>

      {/* Planificado, desviación y estado */}
      <Card className="lg:col-span-2">
        <CardContent className="grid grid-cols-1 gap-4 py-5 sm:grid-cols-3">
          <Kpi
            label="Avance planificado"
            value={`${data.plannedProgress}%`}
            hint={`Al ${fechaLarga(data.asOf)}`}
            tv={tv}
          />
          <Kpi
            label="Desviación"
            value={`${dev > 0 ? '+' : ''}${dev} pp`}
            hint="Real menos planificado"
            valueClass={devColor}
            tv={tv}
          />
          <div className="flex flex-col justify-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Estado</span>
            <Badge variant={est.badge} className={tv ? 'w-fit px-3 py-1 text-base' : 'w-fit'}>
              <est.Icon className="mr-1.5 size-3.5" aria-hidden />
              {est.label}
            </Badge>
            <span className={`text-muted-foreground ${tv ? 'text-sm' : 'text-xs'}`}>
              {fechaLarga(data.programStart)} al {fechaLarga(data.programEnd)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  valueClass = 'text-foreground',
  tv,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
  tv: boolean;
}): ReactNode {
  return (
    <div className="flex flex-col justify-center">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`mt-1 font-bold tabular-nums ${tv ? 'text-5xl' : 'text-3xl'} ${valueClass}`}>
        {value}
      </span>
      <span className={`mt-1 text-muted-foreground ${tv ? 'text-sm' : 'text-xs'}`}>{hint}</span>
    </div>
  );
}

// ── Gauge ────────────────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

/** Arco de semicírculo: 0..100 → 180° (izquierda) a 0° (derecha). */
function arco(cx: number, cy: number, r: number, from: number, to: number): string {
  const a0 = 180 - (from / 100) * 180;
  const a1 = 180 - (to / 100) * 180;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function Gauge({ real, planned, tv }: { real: number; planned: number; tv: boolean }): ReactNode {
  const cx = 110;
  const cy = 110;
  const r = 88;
  // La marca del planificado va sobre el mismo arco: se compara de un vistazo
  // sin leer los números.
  const [mx1, my1] = polar(cx, cy, r + 11, 180 - (planned / 100) * 180);
  const [mx0, my0] = polar(cx, cy, r - 11, 180 - (planned / 100) * 180);
  return (
    <div className="flex w-full flex-col items-center">
      <svg
        viewBox="0 0 220 128"
        className={tv ? 'w-full max-w-[320px]' : 'w-full max-w-[230px]'}
        role="img"
        aria-label={`Avance real ${real}% contra ${planned}% planificado`}
      >
        <path
          d={arco(cx, cy, r, 0, 100)}
          fill="none"
          className="stroke-muted"
          strokeWidth={18}
          strokeLinecap="round"
        />
        <path
          d={arco(cx, cy, r, 0, Math.max(real, 0.4))}
          fill="none"
          className="stroke-primary"
          strokeWidth={18}
          strokeLinecap="round"
        />
        <line x1={mx0} y1={my0} x2={mx1} y2={my1} className="stroke-amber-500" strokeWidth={3} />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-foreground text-[34px] font-bold tabular-nums"
        >
          {real}%
        </text>
      </svg>
      <span
        className={`mt-1 uppercase tracking-wide text-muted-foreground ${tv ? 'text-sm' : 'text-xs'}`}
      >
        Avance real de obra
      </span>
      <span
        className={`mt-1 inline-flex items-center gap-1.5 text-muted-foreground ${tv ? 'text-sm' : 'text-xs'}`}
      >
        <span className="h-0.5 w-3 bg-amber-500" aria-hidden /> Planificado {planned}%
      </span>
    </div>
  );
}

// ── Curva S ──────────────────────────────────────────────────────────────────

/**
 * Cuatro curvas sobre el mismo eje: la banda entre la temprana y la tardía es el
 * margen que da la programación (holgura). Mientras la curva real esté dentro de
 * la banda la obra llega; si cae bajo la tardía, ya no.
 */
function SCurve({ curves, tv }: { curves: ObraDashboard['curves']; tv: boolean }): ReactNode {
  const W = 720;
  const H = tv ? 340 : 260;
  const PAD = { top: 14, right: 18, bottom: 30, left: 40 };
  const todas = [...curves.early, ...curves.scheduled, ...curves.late, ...curves.real];
  if (todas.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Todavía no hay fechas programadas para dibujar la curva.
      </p>
    );
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

  // Banda de holgura: la temprana de ida y la tardía de vuelta cierran el área.
  const banda =
    curves.early.length > 0 && curves.late.length > 0
      ? `${linea(curves.early)} ${[...curves.late].reverse().map(punto).join(' ')}`
      : null;

  const ejeX = [minT, minT + spanT / 3, minT + (2 * spanT) / 3, maxT];
  const isoDe = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ultimoReal = curves.real[curves.real.length - 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[460px]"
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
          />
        )}
        {curves.early.length > 0 && (
          <polyline
            points={linea(curves.early)}
            fill="none"
            className="stroke-muted-foreground/50"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
        )}
        {curves.scheduled.length > 0 && (
          <polyline
            points={linea(curves.scheduled)}
            fill="none"
            className="stroke-amber-500"
            strokeWidth={2.5}
            strokeDasharray="6 4"
          />
        )}
        {curves.real.length > 0 && (
          <polyline
            points={linea(curves.real)}
            fill="none"
            className="stroke-primary"
            strokeWidth={3.5}
            strokeLinejoin="round"
          />
        )}
        {ultimoReal && (
          <circle cx={x(ultimoReal.date)} cy={y(ultimoReal.value)} r={5} className="fill-primary" />
        )}

        {ejeX.map((t, i) => (
          <text
            key={t}
            x={PAD.left + ((t - minT) / spanT) * plotW}
            y={H - 9}
            textAnchor={i === 0 ? 'start' : i === ejeX.length - 1 ? 'end' : 'middle'}
            className="fill-muted-foreground text-[11px]"
          >
            {fechaCorta(isoDe(t))}
          </text>
        ))}
      </svg>

      <div
        className={`mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-muted-foreground ${tv ? 'text-sm' : 'text-xs'}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-5 rounded bg-primary" aria-hidden /> Real ejecutado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-5 border-t-2 border-dashed border-amber-500" aria-hidden /> Programa
          vigente
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm bg-primary/10" aria-hidden /> Margen entre inicio
          temprano y tardío
        </span>
      </div>
    </div>
  );
}

// ── Hitos ────────────────────────────────────────────────────────────────────

function Milestones({ items, tv }: { items: ObraMilestone[]; tv: boolean }): ReactNode {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sin hitos definidos.</p>;
  }
  return (
    <ol className="flex flex-col">
      {items.map((h, i) => (
        <li key={h.id} className="flex gap-3">
          {/* Riel vertical: el punto marca el hito, la línea une con el siguiente */}
          <div className="flex flex-col items-center">
            <span
              className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                h.done ? 'border-primary bg-primary' : 'border-border bg-card'
              }`}
              aria-hidden
            >
              {h.done && <Flag className="size-2 text-primary-foreground" />}
            </span>
            {i < items.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden />}
          </div>
          <div className={`pb-3 ${tv ? 'text-base' : 'text-sm'}`}>
            <p className={h.done ? 'font-medium text-foreground' : 'font-medium text-muted-foreground'}>
              {h.name}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {fechaLarga(h.date)}
              {h.done && <span className="ml-1.5 text-primary">· cumplido</span>}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Fases y actividades ──────────────────────────────────────────────────────

function PhaseRow({ phase, tv }: { phase: ObraPhase; tv: boolean }): ReactNode {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${abierta ? '' : '-rotate-90'}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className={`truncate font-semibold ${tv ? 'text-lg' : 'text-sm'}`}>{phase.name}</span>
            <span className={`shrink-0 font-bold tabular-nums ${tv ? 'text-lg' : 'text-sm'}`}>
              {phase.percent}%
            </span>
          </div>
          <Bar percent={phase.percent} />
          <p className="mt-1 text-xs text-muted-foreground">
            {phase.activities.length}{' '}
            {phase.activities.length === 1 ? 'actividad' : 'actividades'}
          </p>
        </div>
      </button>

      {abierta && (
        <ul className="flex flex-col gap-2 border-t border-border px-3 py-3">
          {phase.activities.map((a) => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: ObraLine }): ReactNode {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 flex-1 truncate text-foreground">{activity.name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {cantidad(activity.quantityDone)} / {cantidad(activity.quantityTotal)}
          {activity.unit ? ` ${activity.unit}` : ''}
        </span>
        <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{activity.percent}%</span>
      </div>
      <Bar percent={activity.percent} thin />
    </li>
  );
}

function Bar({ percent, thin = false }: { percent: number; thin?: boolean }): ReactNode {
  return (
    <div className={`mt-1.5 w-full overflow-hidden rounded-full bg-muted ${thin ? 'h-1' : 'h-2'}`}>
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export { fechaLarga };
