import { useEffect, useState, type ReactNode } from 'react';
import { Timer, UserRound, Info, CircleStop, Ban } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { UsageCycleView } from '@/types/assets';
import { formatDuration, personName } from './usage-cycle-shared';

export interface UsageCycleTimerCardProps {
  /** Ciclo activo del activo (EN_PREPARACION o EN_CURSO). */
  cycle: UsageCycleView;
  /** "Terminar uso" (solo EN_CURSO). Abre el diálogo de cierre. */
  onEnd: () => void;
  /** "Cancelar" el reporte (solo EN_PREPARACION). */
  onCancel: () => void;
  /** Deshabilita los botones mientras corre una acción del ciclo. */
  busy?: boolean;
}

/**
 * Tarjeta de TIMER EN VIVO del uso activo de un activo. Muestra quién lo usa,
 * desde cuándo y un cronómetro que corre (un tick por segundo). Mobile-first.
 *
 * - EN_PREPARACION: aviso "Completa el checklist para confirmar" + botón "Cancelar".
 * - EN_CURSO: botón "Terminar uso".
 *
 * El cronómetro cuenta desde `confirmedAt` cuando el ciclo ya está EN_CURSO (o
 * desde `startedAt` si aún no hay confirmación), reflejando el tiempo real de uso.
 */
export function UsageCycleTimerCard({
  cycle,
  onEnd,
  onCancel,
  busy = false,
}: UsageCycleTimerCardProps): ReactNode {
  const isPreparing = cycle.status === 'EN_PREPARACION';
  const since = cycle.status === 'EN_CURSO' ? cycle.confirmedAt ?? cycle.startedAt : cycle.startedAt;

  // Un tick por segundo: `now` provoca un único re-render liviano por segundo. Se
  // limpia el intervalo en el cleanup para no dejarlo corriendo al desmontar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const startMs = new Date(since).getTime();
  const elapsedSec = Number.isNaN(startMs) ? 0 : (now - startMs) / 1000;

  return (
    <Card className={isPreparing ? 'border-amber-500/40 bg-amber-500/5' : 'border-primary/40 bg-primary/5'}>
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
                isPreparing ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300' : 'bg-primary/15 text-primary'
              }`}
              aria-hidden
            >
              <Timer className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isPreparing ? 'warning' : 'info'}>
                  {isPreparing ? 'En preparación' : 'En uso'}
                </Badge>
                <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                  <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                  {personName(cycle.user)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Desde {formatDateTime(since)}
              </p>
            </div>
          </div>

          {/* Cronómetro en vivo. `aria-live` para lectores de pantalla. */}
          <div
            className="flex flex-col items-start gap-0.5 sm:items-end"
            aria-live="off"
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Tiempo de uso
            </span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {formatDuration(elapsedSec)}
            </span>
          </div>
        </div>

        {isPreparing ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Completa el checklist para confirmar el uso.</span>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={busy}
                loading={busy}
              >
                <Ban className="size-3.5" aria-hidden />
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" onClick={onEnd} disabled={busy}>
              <CircleStop className="size-3.5" aria-hidden />
              Terminar uso
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
