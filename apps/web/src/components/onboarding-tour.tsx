import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Circle, Sparkles, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useOnboarding } from '@/hooks/use-onboarding';

/**
 * Tour de onboarding (§6-1.2). Checklist con progreso DERIVADO de datos reales
 * (CV/documentos). "Omitir" pospone solo la sesión actual (decisión §9): no marca
 * como completado, reaparece al próximo ingreso hasta que los pasos se cumplan.
 * Cuando todos los pasos están hechos, no se muestra.
 */
export function OnboardingTour(): ReactNode {
  const { steps, completed, total, allComplete, loading, dismissed, dismiss } = useOnboarding();

  if (loading || dismissed || allComplete || total === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            Primeros pasos
          </CardTitle>
          <CardDescription>
            Completa tu perfil para aprovechar GTM Link. {completed} de {total} listos.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={dismiss}
          className="text-muted-foreground"
        >
          <X aria-hidden />
          Omitir por ahora
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div
          className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Progreso de onboarding"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>

        <ul className="flex flex-col divide-y divide-border">
          {steps.map((step) => (
            <li key={step.key} className="flex items-center gap-3 py-3">
              {step.done ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Check className="size-3.5" aria-hidden />
                  <span className="sr-only">Completado:</span>
                </span>
              ) : (
                <Circle className="size-6 shrink-0 text-muted-foreground/40" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    step.done && 'text-muted-foreground line-through',
                  )}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
              {!step.done && (
                <Link
                  to={step.href}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  Ir
                  <ArrowRight aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
