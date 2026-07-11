import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/use-notifications';
import { NotificationItem } from '@/components/notifications/notification-item';
import type { NotificationView } from '@/types/notifications';

/** Cantidad máxima mostrada en el badge antes de "+". */
const BADGE_CAP = 9;

/**
 * Campana de notificaciones para el shell (§6-2.2). Botón con `aria-label` y
 * `aria-expanded` que despliega un panel propio accesible (cierra al hacer clic
 * fuera o con Esc) con las últimas notificaciones. Al elegir una se marca leída
 * y se navega a su `link` si lo tiene. Incluye un pie "Ver todas".
 *
 * `variant="icon"` (por defecto) es el botón fantasma cuadrado para la topbar;
 * `variant="row"` es una fila ancha alineada a la izquierda para el sidebar.
 */
export function NotificationBell({
  variant = 'icon',
}: {
  variant?: 'icon' | 'row';
}): ReactNode {
  const navigate = useNavigate();
  const { items, unreadCount, loading, error, refetch, markRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Cierra al hacer clic fuera del contenedor (botón + panel).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, close]);

  // Cierra con Esc y devuelve el foco al botón disparador.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // Al abrir, refresca para traer el estado más reciente.
  const handleToggle = (): void => {
    setOpen((prev) => {
      const next = !prev;
      if (next) void refetch();
      return next;
    });
  };

  const handleSelect = async (notification: NotificationView): Promise<void> => {
    close();
    try {
      await markRead(notification.id);
    } catch {
      // markRead ya revierte y registra el error; igual navegamos si hay link.
    }
    if (notification.link) navigate(notification.link);
  };

  const preview = items.slice(0, 6);
  const badgeLabel =
    unreadCount > BADGE_CAP ? `${BADGE_CAP}+` : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size={variant === 'icon' ? 'icon' : 'sm'}
        onClick={handleToggle}
        aria-label={
          unreadCount > 0
            ? `Notificaciones, ${unreadCount} sin leer`
            : 'Notificaciones'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cn(
          'relative text-muted-foreground',
          variant === 'row' && 'w-full justify-start gap-3',
        )}
      >
        <Bell aria-hidden />
        {variant === 'row' && <span>Notificaciones</span>}
        {unreadCount > 0 && (
          <>
            <span
              className={cn(
                'absolute flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground',
                variant === 'icon'
                  ? 'right-1 top-1 h-4'
                  : 'right-2 top-1.5 h-4',
              )}
              aria-hidden
            >
              {badgeLabel}
            </span>
            <span className="sr-only">{unreadCount} sin leer</span>
          </>
        )}
      </Button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notificaciones recientes"
          className={cn(
            'absolute z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-lg outline-none',
            'animate-content-in',
            // Topbar (icon): campana arriba-derecha → panel HACIA ABAJO, alineado a la derecha.
            // Sidebar footer (row): pegado al borde inferior → panel HACIA ARRIBA, a la izquierda,
            // para que no se corte fuera de pantalla.
            variant === 'icon' ? 'top-full mt-2 right-0' : 'bottom-full mb-2 left-0',
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Notificaciones</span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {unreadCount} sin leer
              </span>
            )}
          </div>

          <div className="max-h-[min(60vh,24rem)] overflow-y-auto">
            {loading && preview.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Cargando…
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  Reintentar
                </Button>
              </div>
            ) : preview.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No tienes notificaciones.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {preview.map((notification) => (
                  <li key={notification.id}>
                    <NotificationItem
                      notification={notification}
                      onSelect={(n) => void handleSelect(n)}
                      compact
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={() => {
                close();
                navigate('/notificaciones');
              }}
            >
              Ver todas
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
