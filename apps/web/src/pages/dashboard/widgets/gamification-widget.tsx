import { type ReactNode, useCallback, useEffect, useState, useRef } from 'react';
import { Trophy } from 'lucide-react';
import { WidgetShell } from './widget-shell';
import { getGamificationProfile } from '@/lib/api';
import type { GamificationProfile } from '@/lib/api';

/** Nombres legibles de las acciones de gamificación para el historial. */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  FIRST_LOGIN: 'Primer login',
  COMPLETE_CV: 'CV completado',
  UPLOAD_DOC: 'Documento subido',
  CREATE_TASK: 'Tarea creada',
  COMPLETE_TASK: 'Tarea completada',
  RUN_CHECKLIST: 'Checklist ejecutado',
  WAREHOUSE_TX: 'Transacción de bodega',
  RATE_PROVIDER: 'Evaluación de proveedor',
};

const RANK_DETAILS = {
  BRONCE: { name: 'Bronce', color: 'text-amber-600 dark:text-amber-500', stroke: '#cd7f32', bg: 'bg-amber-600/10' },
  PLATA: { name: 'Plata', color: 'text-slate-400 dark:text-slate-300', stroke: '#c0c0c0', bg: 'bg-slate-300/10' },
  ORO: { name: 'Oro', color: 'text-yellow-500 dark:text-yellow-400', stroke: '#ffd700', bg: 'bg-yellow-400/10' },
  PLATINO: { name: 'Platino', color: 'text-cyan-500 dark:text-cyan-400', stroke: '#38bdf8', bg: 'bg-cyan-400/10' },
};

/**
 * Widget de gamificación para el dashboard (§6-7.1).
 * Muestra puntos totales, badges desbloqueados, y progreso hacia logros pendientes.
 */
export function GamificationWidget(): ReactNode {
  const [data, setData] = useState<GamificationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await getGamificationProfile();
      if (mountedRef.current) {
        setData(profile);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Error al cargar gamificación.');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // SVG parameters for the progress ring
  const size = 120;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;

  return (
    <WidgetShell
      title="Mi Progreso"
      description="Rendimiento y logros acumulados."
      icon={Trophy}
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      {data && (() => {
        const details = RANK_DETAILS[data.rank] || RANK_DETAILS.BRONCE;
        const strokeDashoffset = circumference - (data.rankProgress / 100) * circumference;

        return (
          <div className="flex flex-col gap-4">
            {/* Rank ring & Period Points */}
            <div className="flex flex-col sm:flex-row items-center gap-6 bg-card/20 p-4 rounded-xl border border-border">
              <div className="relative flex items-center justify-center shrink-0">
                <svg width={size} height={size} className="transform -rotate-90">
                  {/* Background Track */}
                  <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="transparent"
                    stroke="rgba(var(--border), 0.15)"
                    strokeWidth={strokeWidth}
                  />
                  {/* Progress Ring */}
                  <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="transparent"
                    stroke={details.stroke}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-500 ease-out"
                  />
                </svg>
                {/* Center Content */}
                <div className="absolute flex flex-col items-center justify-center text-center">
                  <span className={`text-base font-bold tracking-tight ${details.color}`}>
                    {details.name}
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5 font-semibold">
                    {data.periodPoints} pts
                  </span>
                  <span className="text-[9px] text-muted-foreground/60">
                    últ. 30 días
                  </span>
                </div>
              </div>

              {/* Progress Detail info */}
              <div className="flex flex-col gap-1.5 flex-1 w-full">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-muted-foreground font-medium">Meta Siguiente:</span>
                  <span className="text-xs font-bold text-foreground font-mono">{data.nextRank}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-muted-foreground font-medium">Avance Rango:</span>
                  <span className="text-xs font-bold text-foreground font-mono">{data.rankProgress}%</span>
                </div>
                <div className="flex justify-between items-baseline border-t border-dashed border-border pt-1.5 mt-0.5">
                  <span className="text-xs text-muted-foreground font-semibold">Total Acumulado:</span>
                  <span className="text-sm font-extrabold text-primary font-mono">{data.points} Pts</span>
                </div>
              </div>
            </div>

            {/* Badges unlocked list */}
            {data.unlocked.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Logros Desbloqueados ({data.unlocked.length})</p>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  {data.unlocked.map((ach) => (
                    <span
                      key={ach.key}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/5 border border-primary/10 px-2 py-0.5 text-xs font-medium text-foreground transition-all hover:bg-primary/10"
                      title={ach.description}
                    >
                      <span aria-hidden>{ach.icon}</span>
                      {ach.title}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Point Activity */}
            {data.recentPoints.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted-foreground">Actividad Reciente</p>
                <div className="flex flex-col gap-1.5">
                  {data.recentPoints.slice(0, 3).map((entry, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-muted-foreground bg-muted/10 p-1.5 rounded-lg border border-transparent hover:border-border transition-all">
                      <span className="font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                      <span className="tabular-nums font-bold text-primary">+{entry.points} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </WidgetShell>
  );
}
