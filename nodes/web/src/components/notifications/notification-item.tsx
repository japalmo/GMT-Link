import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';
import type { NotificationView } from '@/types/notifications';

/**
 * Fila de una notificación, reutilizada por la campana (dropdown) y por la
 * página completa. Es un `<button>` accesible: al activarla, el contenedor marca
 * leída y navega al `link` si lo tiene. Muestra un punto cuando está sin leer y
 * el tiempo relativo en es-CL. `compact` reduce el padding para el dropdown.
 */
export function NotificationItem({
  notification,
  onSelect,
  compact = false,
}: {
  notification: NotificationView;
  onSelect: (notification: NotificationView) => void;
  compact?: boolean;
}): ReactNode {
  const unread = notification.readAt === null;
  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      className={cn(
        'flex w-full items-start gap-3 text-left outline-none transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        compact ? 'px-4 py-3' : 'rounded-md px-4 py-3',
        unread && 'bg-primary/5',
      )}
      aria-label={`${notification.title}${unread ? ' (sin leer)' : ''}`}
    >
      <span
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              unread ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}
          >
            {notification.title}
          </span>
          <time
            dateTime={notification.createdAt}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {formatRelativeTime(notification.createdAt)}
          </time>
        </span>
        {notification.body && (
          <span
            className={cn(
              'text-xs text-muted-foreground',
              compact ? 'line-clamp-2' : '',
            )}
          >
            {notification.body}
          </span>
        )}
      </span>
    </button>
  );
}
