import type { ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PersonalDocumentView } from '@/types/documents';

/** Texto auxiliar de días para vencer / vencido. */
function daysText(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) {
    const abs = Math.abs(days);
    return `Venció hace ${abs} ${abs === 1 ? 'día' : 'días'}`;
  }
  if (days === 0) return 'Vence hoy';
  return `Faltan ${days} ${days === 1 ? 'día' : 'días'}`;
}

/**
 * Celda de vencimiento de un documento (§6-1.5). Muestra la fecha y, según el
 * backend, un badge "Vence pronto" (ámbar) o "Vencido" (rojo) junto al texto de
 * días restantes. Si no hay fecha de vencimiento, indica "Sin vencimiento".
 */
export function ExpiryCell({ document }: { document: PersonalDocumentView }): ReactNode {
  if (!document.expiresAt) {
    return <span className="text-sm text-muted-foreground">Sin vencimiento</span>;
  }

  const expired = document.daysToExpire !== null && document.daysToExpire < 0;
  const days = daysText(document.daysToExpire);

  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
        {formatDate(document.expiresAt)}
      </span>
      {(expired || document.expiringSoon) && (
        <span
          className={cn(
            'inline-flex w-fit items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
            expired ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800',
          )}
        >
          {expired ? 'Vencido' : 'Vence pronto'}
        </span>
      )}
      {days && <span className="text-xs text-muted-foreground">{days}</span>}
    </div>
  );
}
