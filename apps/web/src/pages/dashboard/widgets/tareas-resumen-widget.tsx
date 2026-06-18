import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, AlertCircle } from 'lucide-react';
import { ApiError, listTasks } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TaskView } from '@/types/operations';
import { WidgetShell } from './widget-shell';

/** Mensaje legible a partir de un error de API o genérico. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

interface WeekData {
  start: Date;
  end: Date;
  label: string;
  pending: number;
  completed: number;
}

/**
 * Widget "Resumen de Tareas" (§6-2.1). Muestra un gráfico de barras apiladas
 * en SVG puro con la relación de tareas completadas y pendientes de las últimas 4 semanas.
 */
export function TareasResumenWidget(): ReactNode {
  const [tasks, setTasks] = useState<TaskView[]>([]);
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
      const data = await listTasks({});
      if (mountedRef.current) {
        setTasks(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar las tareas.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Agrupamiento por semanas (últimas 4 semanas)
  const today = new Date();
  const weeks: WeekData[] = Array.from({ length: 4 }, (_, i) => {
    const start = new Date(today.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(today.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    
    // Label format: "16 Jun"
    const startDay = start.getDate();
    const startMonth = start.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
    const label = `${startDay} ${startMonth}`;

    return {
      start,
      end,
      label,
      pending: 0,
      completed: 0,
    };
  }).reverse(); // Del pasado al presente

  // Clasificar tareas en su respectiva semana
  tasks.forEach((task) => {
    const isCompleted = task.status === 'COMPLETADO';
    const taskDate = new Date(isCompleted ? task.updatedAt : task.createdAt);
    for (const week of weeks) {
      if (taskDate >= week.start && taskDate < week.end) {
        if (isCompleted) {
          week.completed++;
        } else {
          week.pending++;
        }
        break;
      }
    }
  });

  const maxTotal = Math.max(...weeks.map((w) => w.pending + w.completed), 1);
  const totalPending = tasks.filter((t) => t.status !== 'COMPLETADO').length;
  const totalCompleted = tasks.filter((t) => t.status === 'COMPLETADO').length;

  return (
    <WidgetShell
      title="Resumen de Tareas"
      description="Tareas activas y completadas"
      icon={CheckSquare}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-start gap-2 py-4">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <AlertCircle className="size-4 text-muted-foreground" aria-hidden />
              No hay tareas registradas en el backlog.
            </p>
            <Link
              to="/operaciones/backlog"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ir al Backlog
            </Link>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            {/* SVG Stacked Bar Chart */}
            <div className="flex-1 w-full h-32 bg-accent/20 rounded-xl p-2 border border-border/40">
              <svg viewBox="0 0 320 120" className="w-full h-full">
                {/* Líneas de cuadrícula horizontal */}
                <line x1="30" y1="10" x2="300" y2="10" stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 3" />
                <line x1="30" y1="50" x2="300" y2="50" stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 3" />
                <line x1="30" y1="90" x2="300" y2="90" stroke="currentColor" strokeOpacity="0.1" />

                {weeks.map((w, i) => {
                  const x = 40 + i * 70;
                  const total = w.pending + w.completed;
                  // Altura máxima del gráfico es 80px
                  const compH = (w.completed / maxTotal) * 80;
                  const pendH = (w.pending / maxTotal) * 80;

                  return (
                    <g key={i} className="group">
                      <title>{`${w.label}: ${w.completed} completadas, ${w.pending} pendientes`}</title>
                      {/* Porción Completada (Abajo en verde) */}
                      {compH > 0 && (
                        <rect
                          x={x}
                          y={90 - compH}
                          width="24"
                          height={compH}
                          className="fill-emerald-500/90 transition-all duration-300 group-hover:fill-emerald-500"
                          rx="2"
                        />
                      )}
                      {/* Porción Pendiente (Arriba en color primario) */}
                      {pendH > 0 && (
                        <rect
                          x={x}
                          y={90 - compH - pendH}
                          width="24"
                          height={pendH}
                          className="fill-primary/80 transition-all duration-300 group-hover:fill-primary"
                          rx="2"
                        />
                      )}
                      {/* Texto total */}
                      {total > 0 && (
                        <text
                          x={x + 12}
                          y={90 - compH - pendH - 4}
                          textAnchor="middle"
                          className="text-[9px] font-bold fill-foreground"
                        >
                          {total}
                        </text>
                      )}
                      {/* Label de la semana */}
                      <text
                        x={x + 12}
                        y="106"
                        textAnchor="middle"
                        className="text-[9px] font-semibold fill-muted-foreground"
                      >
                        {w.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Panel de control de leyenda y estadísticas directas */}
            <div className="flex flex-col justify-between w-full sm:w-44 shrink-0 sm:border-l border-border pt-2 sm:pt-0 sm:pl-4">
              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Total Acumulado
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-foreground">{tasks.length}</span>
                    <span className="text-xs text-muted-foreground">tareas</span>
                  </div>
                </div>

                {/* Leyenda */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded bg-primary/80 shrink-0" />
                    <span className="text-muted-foreground">Pendientes:</span>
                    <span className="font-semibold ml-auto">{totalPending}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded bg-emerald-500 shrink-0" />
                    <span className="text-muted-foreground">Completadas:</span>
                    <span className="font-semibold ml-auto">{totalCompleted}</span>
                  </div>
                </div>
              </div>

              <Link
                to="/operaciones/backlog"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'mt-3 w-full text-xs font-semibold',
                )}
              >
                Ver Backlog
              </Link>
            </div>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
