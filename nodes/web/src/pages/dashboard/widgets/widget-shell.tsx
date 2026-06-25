import type { ReactNode } from 'react';
import { AlertCircle, type LucideIcon } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Contenedor visual común de un widget del dashboard: título, descripción e
 * icono en la cabecera, y un cuerpo que gestiona los estados carga/vacío/error
 * de forma consistente entre todos los widgets (§6-2.1). Cada widget concreto
 * trae su propio dato (reusando endpoints existentes) y solo pasa aquí su
 * estado y contenido.
 */
export function WidgetShell({
  title,
  description,
  icon: Icon,
  loading,
  error,
  onRetry,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  children?: ReactNode;
}): ReactNode {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && (
            <CardDescription className="text-xs">{description}</CardDescription>
          )}
        </div>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-end pt-0">
        {loading ? (
          <WidgetSkeleton />
        ) : error ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <AlertCircle className="size-4 text-destructive" aria-hidden />
              {error}
            </p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Reintentar
              </Button>
            )}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** Esqueleto de carga que respeta la forma típica de un widget (cifra + texto). */
function WidgetSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
      <div className="h-3 w-32 animate-pulse rounded bg-muted" />
    </div>
  );
}
