import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RotateCw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  /** Icono lucide (default: `Inbox`). Se renderiza `size-8` apagado. */
  icon?: LucideIcon;
  /** Título opcional (más prominente que el mensaje). */
  title?: ReactNode;
  /** Mensaje descriptivo. */
  message: ReactNode;
  /** Acción opcional (p. ej. un `<Button>` "Crear el primero"). */
  action?: ReactNode;
  /** Clase opcional del contenedor. */
  className?: string;
}

/**
 * Estado vacío canónico del design system (canon de `RoleScopedList`): icono
 * `size-8` apagado, `p-12`, centrado, `role="status"`. Reutilizable en listas,
 * tablas y secciones sin datos.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  className,
}: EmptyStateProps): ReactNode {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center gap-2 p-12 text-center',
        className,
      )}
    >
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* LoadingState                                                                */
/* -------------------------------------------------------------------------- */

export interface LoadingStateProps {
  /** Cantidad de filas skeleton (default: 5). */
  rows?: number;
  /** Clase opcional del contenedor. */
  className?: string;
  /** Etiqueta accesible del estado de carga (default: "Cargando…"). */
  label?: string;
}

/**
 * Estado de carga canónico: filas skeleton `h-4 animate-pulse` marcadas
 * `aria-hidden`, dentro de un contenedor `role="status"` con etiqueta accesible.
 */
export function LoadingState({
  rows = 5,
  className,
  label = 'Cargando…',
}: LoadingStateProps): ReactNode {
  return (
    <div role="status" aria-busy className={cn('flex flex-col gap-3 p-4', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-4 w-full animate-pulse rounded bg-muted"
          aria-hidden
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ErrorState                                                                  */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  /** Mensaje de error legible. */
  message: ReactNode;
  /** Callback opcional del botón "Reintentar". */
  onRetry?: () => void;
  /** Etiqueta del botón de reintento (default: "Reintentar"). */
  retryLabel?: string;
  /** Clase opcional del contenedor. */
  className?: string;
}

/**
 * Estado de error canónico (canon de `RoleScopedList`): `AlertCircle` `size-8`,
 * `p-12`, `role="alert"`, `border-destructive/30 bg-destructive/5`, con botón
 * opcional de reintento.
 */
export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Reintentar',
  className,
}: ErrorStateProps): ReactNode {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-12 text-center',
        className,
      )}
    >
      <AlertCircle className="size-8 text-destructive" aria-hidden />
      <p className="max-w-sm text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
