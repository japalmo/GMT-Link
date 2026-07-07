import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** Eyebrow / etiqueta pequeña sobre el título (opcional). */
  label?: ReactNode;
  /** Título de la página (canónico: `text-2xl font-bold tracking-tight`). */
  title: ReactNode;
  /** Descripción bajo el título (opcional). */
  description?: ReactNode;
  /** Acciones a la derecha (botones, filtros). Se apilan en móvil. */
  actions?: ReactNode;
  /**
   * `gradient` aplica el `bg-clip-text` de degradado detrás del título (canon de
   * `recursos/index.tsx`). Default: `default`.
   */
  variant?: 'default' | 'gradient';
  /** Clase opcional del contenedor raíz. */
  className?: string;
}

/**
 * Cabecera de página del design system. Título canónico
 * `text-2xl font-bold tracking-tight`; `variant="gradient"` encapsula el
 * `bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent`.
 * Mobile-first: acciones bajo el texto en móvil, a la derecha en ≥640px.
 */
export function PageHeader({
  label,
  title,
  description,
  actions,
  variant = 'default',
  className,
}: PageHeaderProps): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        {label && (
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
        )}
        <h1
          className={cn(
            'text-2xl font-bold tracking-tight',
            variant === 'gradient' &&
              'bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent',
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
