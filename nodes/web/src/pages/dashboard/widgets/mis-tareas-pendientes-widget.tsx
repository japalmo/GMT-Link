import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, CalendarClock } from 'lucide-react';
import { errorToMessage, listTasks } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/context/auth-context';
import type { TaskView } from '@/types/operations';
import { WidgetShell } from './widget-shell';

/** Máximo de tareas listadas en el widget para mantenerlo compacto. */
const MAX_ITEMS = 5;

/**
 * Widget "Mis tareas pendientes" (§6-2.1). Lista de forma compacta las tareas
 * PENDIENTES asignadas al usuario autenticado (nombre, proyecto y fecha),
 * consumiendo `GET /tasks?assignedToId=<me>&status=PENDIENTE`. El `userId` se
 * obtiene del usuario autenticado en `auth-context` (`useAuth().user.id`).
 */
export function MisTareasPendientesWidget(): ReactNode {
  const { user } = useAuth();
  const userId = user?.id ?? null;

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
    if (!userId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listTasks({ assignedToId: userId, status: 'PENDIENTE' });
      if (mountedRef.current) setTasks(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(errorToMessage(err, 'No se pudieron cargar tus tareas.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = tasks.slice(0, MAX_ITEMS);
  const extra = tasks.length - visible.length;

  return (
    <WidgetShell
      title="Mis tareas pendientes"
      description="Tareas asignadas a ti sin completar"
      icon={ListChecks}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-3">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-sm text-muted-foreground">Sin tareas pendientes.</p>
            <Link
              to="/operaciones/backlog"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ir al Backlog
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {visible.map((task) => (
                <li key={task.id} className="flex flex-col gap-0.5 py-2 first:pt-0">
                  <span className="truncate text-sm font-medium text-foreground">
                    {task.name}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{task.project.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <CalendarClock className="size-3" aria-hidden />
                      {formatDate(task.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {extra > 0 && (
              <p className="text-xs text-muted-foreground">
                y {extra} {extra === 1 ? 'tarea más' : 'tareas más'}.
              </p>
            )}
            <Link
              to="/operaciones/backlog"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'w-full',
              )}
            >
              Ver Backlog
            </Link>
          </>
        )}
      </div>
    </WidgetShell>
  );
}
