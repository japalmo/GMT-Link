import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LayoutDashboard, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { getProjectDashboard, errorToMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type {
  ProjectDashboard,
  DashboardMetrics,
  DashboardCurvePoint,
} from '@gmt-platform/contracts';

const TOTAL = '__TOTAL__';

/**
 * Pestaña Dashboard de la vista de proyecto: avance ejecutivo de producción.
 * Consolida las actividades por servicio, con card de resumen, curva de avance
 * real vs proyectado (SVG a mano, como el resto de la app), gauge de avance,
 * fechas de término y desglose por servicio en la vista TOTAL. Lee datos reales.
 */
export function DashboardTab({ projectId }: { projectId: string }): ReactNode {
  const [data, setData] = useState<ProjectDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(TOTAL);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getProjectDashboard(projectId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorToMessage(e, 'No se pudo cargar el Dashboard.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => load(), [load]);

  const metrics: DashboardMetrics | null = useMemo(() => {
    if (!data) return null;
    if (selected === TOTAL) return data.total;
    return data.groups.find((g) => g.id === selected)?.metrics ?? data.total;
  }, [data, selected]);

  if (loading) return <LoadingState rows={4} label="Cargando el Dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data || metrics === null) return null;

  if (data.total.total === 0) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="Sin actividades todavía"
        message="El Dashboard mostrará el avance apenas se creen actividades en los servicios del proyecto."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Fila 1 — selector TOTAL | Servicio 1 | ... */}
      <div className="flex flex-wrap gap-1.5">
        <SelectorButton active={selected === TOTAL} onClick={() => setSelected(TOTAL)}>
          TOTAL
        </SelectorButton>
        {data.groups.map((g) => (
          <SelectorButton key={g.id} active={selected === g.id} onClick={() => setSelected(g.id)}>
            {g.name}
          </SelectorButton>
        ))}
      </div>

      {/* Fila 2 — resumen */}
      <SummaryCard metrics={metrics} />

      {/* Fila 3 — curva + gauge */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Curva de avance</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressChart real={metrics.realCurve} projected={metrics.projectedCurve} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Avance</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Gauge real={metrics.realProgress} projected={metrics.projectedProgress} />
          </CardContent>
        </Card>
      </div>

      {/* Fila 4 — fechas de término */}
      <EndDates metrics={metrics} />

      {/* Fila 5 — desglose por servicio, solo en TOTAL */}
      {selected === TOTAL && data.groups.length > 0 && <ServiceBreakdown groups={data.groups} />}
    </div>
  );
}

function SelectorButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCard({ metrics }: { metrics: DashboardMetrics }): ReactNode {
  const items = [
    { label: 'Total', value: metrics.total, cls: 'text-foreground' },
    { label: 'Listas', value: metrics.completed, cls: 'text-emerald-500' },
    { label: 'En proceso', value: metrics.inProgress, cls: 'text-amber-500' },
  ];
  return (
    <Card>
      <CardContent className="grid grid-cols-3 gap-4 py-5">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col items-center">
            <span className={`text-3xl font-bold tabular-nums ${it.cls}`}>{it.value}</span>
            <span className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              {it.label}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Curva de avance (SVG a mano) ────────────────────────────────────────────

function ProgressChart({
  real,
  projected,
}: {
  real: DashboardCurvePoint[];
  projected: DashboardCurvePoint[];
}): ReactNode {
  const W = 640;
  const H = 240;
  const PAD = { top: 12, right: 16, bottom: 28, left: 34 };
  const all = [...real, ...projected];
  if (all.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Aún no hay fechas ni avance para dibujar la curva.
      </p>
    );
  }
  const times = all.map((p) => new Date(p.date).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const spanT = maxT - minT || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (iso: string) => PAD.left + ((new Date(iso).getTime() - minT) / spanT) * plotW;
  const y = (pct: number) => PAD.top + (1 - pct / 100) * plotH;
  const toLine = (pts: DashboardCurvePoint[]) =>
    pts.map((p) => `${x(p.date).toFixed(1)},${y(p.progress).toFixed(1)}`).join(' ');

  const gridY = [0, 25, 50, 75, 100];
  const fmtShort = (t: number) => {
    const d = new Date(t);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[420px]" role="img" aria-label="Curva de avance real vs proyectado">
        {gridY.map((g) => (
          <g key={g}>
            <line x1={PAD.left} y1={y(g)} x2={W - PAD.right} y2={y(g)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(g) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {g}%
            </text>
          </g>
        ))}
        {[minT, (minT + maxT) / 2, maxT].map((t, i) => (
          <text
            key={i}
            x={PAD.left + ((t - minT) / spanT) * plotW}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            className="fill-muted-foreground text-[10px]"
          >
            {fmtShort(t)}
          </text>
        ))}
        {projected.length > 0 && (
          <polyline
            points={toLine(projected)}
            fill="none"
            className="stroke-amber-500"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}
        {real.length > 0 && (
          <polyline points={toLine(real)} fill="none" className="stroke-primary" strokeWidth={2.5} />
        )}
      </svg>
      <div className="mt-1 flex justify-center gap-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-primary" /> Real
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-amber-500" /> Proyectado
        </span>
      </div>
    </div>
  );
}

// ── Gauge de avance (SVG a mano) ────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}
/** Arco de semicírculo: valor 0..100 → ángulo 180°(izq) → 0°(der). */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a0 = 180 - (from / 100) * 180;
  const a1 = 180 - (to / 100) * 180;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function Gauge({ real, projected }: { real: number; projected: number }): ReactNode {
  const cx = 110;
  const cy = 110;
  const r = 90;
  const dev = Math.round((real - projected) * 10) / 10;
  const [mx, my] = polar(cx, cy, r, 180 - (projected / 100) * 180);
  const [mx0, my0] = polar(cx, cy, r - 14, 180 - (projected / 100) * 180);
  const estado =
    dev >= 3
      ? { label: 'Adelantado', cls: 'text-emerald-500', Icon: TrendingUp }
      : dev <= -3
        ? { label: 'Atrasado', cls: 'text-rose-500', Icon: TrendingDown }
        : { label: 'Alineado', cls: 'text-amber-500', Icon: Minus };
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 132" className="w-full max-w-[220px]" role="img" aria-label={`Avance real ${real}%`}>
        <path d={arc(cx, cy, r, 0, 100)} fill="none" className="stroke-muted" strokeWidth={16} strokeLinecap="round" />
        <path d={arc(cx, cy, r, 0, Math.max(real, 0.5))} fill="none" className="stroke-primary" strokeWidth={16} strokeLinecap="round" />
        {/* marca de proyectado */}
        <line x1={mx0} y1={my0} x2={mx} y2={my} className="stroke-amber-500" strokeWidth={3} />
        <text x={cx} y={cy - 8} textAnchor="middle" className="fill-foreground text-[30px] font-bold">
          {real}%
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          Avance real
        </text>
      </svg>
      <div className="mt-1 flex flex-col items-center gap-0.5 text-sm">
        <span className="text-muted-foreground">
          Proyectado: <span className="font-semibold text-foreground">{projected}%</span>
        </span>
        <span className={`inline-flex items-center gap-1 font-semibold ${estado.cls}`}>
          <estado.Icon className="size-4" /> {estado.label} ({dev > 0 ? '+' : ''}
          {dev} pp)
        </span>
      </div>
    </div>
  );
}

// ── Fechas de término ───────────────────────────────────────────────────────

function EndDates({ metrics }: { metrics: DashboardMetrics }): ReactNode {
  const dev = metrics.deviationDays;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardContent className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Término según programa</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {metrics.programEndDate ? formatDate(metrics.programEndDate) : 'Sin fecha planificada'}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Término estimado actual</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {metrics.estimatedEndDate ? formatDate(metrics.estimatedEndDate) : 'Sin avance para estimar'}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Desviación</p>
          <p
            className={`mt-1 text-lg font-semibold ${
              dev === null ? 'text-muted-foreground' : dev > 0 ? 'text-rose-500' : dev < 0 ? 'text-emerald-500' : 'text-amber-500'
            }`}
          >
            {dev === null ? '—' : dev === 0 ? 'En fecha' : `${dev > 0 ? '+' : ''}${dev} días`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Desglose por servicio (vista TOTAL) ─────────────────────────────────────

function ServiceBreakdown({ groups }: { groups: ProjectDashboard['groups'] }): ReactNode {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Resumen por servicio</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Servicio</th>
              <th className="py-2 px-3 text-right font-medium">Total</th>
              <th className="py-2 px-3 text-right font-medium">Listas</th>
              <th className="py-2 px-3 text-right font-medium">En proceso</th>
              <th className="py-2 px-3 text-right font-medium">Avance real</th>
              <th className="py-2 pl-3 text-right font-medium">Proyectado</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const m = g.metrics;
              const behind = m.realProgress + 0.05 < m.projectedProgress;
              return (
                <tr key={g.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3 font-medium text-foreground">{g.name}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{m.total}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-500">{m.completed}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-500">{m.inProgress}</td>
                  <td className={`py-2 px-3 text-right tabular-nums font-semibold ${behind ? 'text-rose-500' : 'text-foreground'}`}>
                    {m.realProgress}%
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">{m.projectedProgress}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
