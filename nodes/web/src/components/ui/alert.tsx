import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted/40 text-foreground',
        destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
        warning:
          'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
        info: 'border-primary/30 bg-primary/5 text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

/** Icono por defecto por variante (usado si no se pasa `icon` ni `icon={null}`). */
const DEFAULT_ICON: Record<
  NonNullable<VariantProps<typeof alertVariants>['variant']>,
  LucideIcon
> = {
  default: Info,
  destructive: TriangleAlert,
  warning: TriangleAlert,
  info: Info,
};

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'>,
    VariantProps<typeof alertVariants> {
  /**
   * Icono lucide a la izquierda. Si se omite, usa el icono por defecto de la
   * variante. Pasa `icon={null}` para no mostrar icono.
   */
  icon?: LucideIcon | null;
  /**
   * Si es `true`, marca el contenedor con `role="alert"` (para errores que
   * aparecen dinámicamente, p. ej. tras un submit fallido). Default: `false`.
   */
  live?: boolean;
}

/**
 * Alerta del design system con variantes de estado. Se usa para errores de
 * formulario (variant `destructive`, `live`) siguiendo el patrón del
 * `reject-dialog` de recursos (`border-destructive/30 bg-destructive/5` +
 * `TriangleAlert`). Slot de icono lucide con default por variante.
 */
const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, icon, live = false, children, ...props }, ref) => {
    const resolvedVariant = variant ?? 'default';
    const Icon = icon === null ? null : (icon ?? DEFAULT_ICON[resolvedVariant]);
    return (
      <div
        ref={ref}
        role={live ? 'alert' : undefined}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {Icon && <Icon aria-hidden />}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  },
);
Alert.displayName = 'Alert';

export { Alert, alertVariants, AlertCircle };
