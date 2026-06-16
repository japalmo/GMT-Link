import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { ApiError, listDocuments } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PersonalDocumentView } from '@/types/documents';
import { WidgetShell } from './widget-shell';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Texto de plazo a partir de los días restantes (puede ser negativo = vencido). */
function dueLabel(days: number | null): string {
  if (days === null) return 'Sin fecha de vencimiento';
  if (days < 0) {
    const n = Math.abs(days);
    return `Vencido hace ${n} ${n === 1 ? 'día' : 'días'}`;
  }
  if (days === 0) return 'Vence hoy';
  return `Vence en ${days} ${days === 1 ? 'día' : 'días'}`;
}

/**
 * Widget "Mis documentos por vencer" (§6-2.1). Trae los documentos que vencen
 * pronto (`GET /documents/me?expiring=true`) y muestra un mini-calendario mensual
 * (grid 7x6) estilo Notion con puntos de colores semánticos basados en vencimientos.
 */
export function DocumentosPorVencerWidget(): ReactNode {
  const [docs, setDocs] = useState<PersonalDocumentView[]>([]);
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
    setLoading(true);
    setError(null);
    try {
      const data = await listDocuments({ expiring: true });
      if (mountedRef.current) {
        // Más urgentes primero (menos días restantes); nulls al final.
        const sorted = [...data].sort((a, b) => {
          const da = a.daysToExpire ?? Number.POSITIVE_INFINITY;
          const db = b.daysToExpire ?? Number.POSITIVE_INFINITY;
          return da - db;
        });
        setDocs(sorted);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar tus documentos.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = docs.length;
  const preview = docs.slice(0, 3);

  // Lógica del calendario mensual 7x6 estilo Notion
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const monthName = today.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const formattedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  const firstDayOfMonth = new Date(year, month, 1);
  let startDayOfWeek = firstDayOfMonth.getDay() - 1; // Lu=0 ... Do=6
  if (startDayOfWeek === -1) startDayOfWeek = 6;

  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const totalDaysInPrevMonth = new Date(year, month, 0).getDate();

  const calendarCells: { date: Date; dayNumber: number; isCurrentMonth: boolean }[] = [];

  // Días del mes anterior
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const day = totalDaysInPrevMonth - i;
    calendarCells.push({
      date: new Date(year, month - 1, day),
      dayNumber: day,
      isCurrentMonth: false,
    });
  }

  // Días del mes actual
  for (let i = 1; i <= totalDaysInMonth; i++) {
    calendarCells.push({
      date: new Date(year, month, i),
      dayNumber: i,
      isCurrentMonth: true,
    });
  }

  // Días del mes siguiente para rellenar 42 celdas
  const remainingCells = 42 - calendarCells.length;
  for (let i = 1; i <= remainingCells; i++) {
    calendarCells.push({
      date: new Date(year, month + 1, i),
      dayNumber: i,
      isCurrentMonth: false,
    });
  }

  const getDocsExpiringOnDate = (date: Date) => {
    return docs.filter((doc) => {
      if (!doc.expiresAt) return false;
      const expDate = new Date(doc.expiresAt);
      return (
        expDate.getFullYear() === date.getFullYear() &&
        expDate.getMonth() === date.getMonth() &&
        expDate.getDate() === date.getDate()
      );
    });
  };

  return (
    <WidgetShell
      title="Mis documentos por vencer"
      description="Vencimientos próximos y alertas"
      icon={CalendarClock}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-4">
        {total === 0 ? (
          <div className="flex flex-col items-start gap-2 py-4">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
              Todos tus documentos están vigentes.
            </p>
            <Link
              to="/perfil/documentos"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ir a mis documentos
            </Link>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 items-stretch">
            {/* Notion-like Calendar Grid */}
            <div className="flex-1 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground tracking-tight">
                  {formattedMonth}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground bg-accent px-1.5 py-0.5 rounded-full">
                  Días de Alerta
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted-foreground mb-1">
                <div>Lu</div>
                <div>Ma</div>
                <div>Mi</div>
                <div>Ju</div>
                <div>Vi</div>
                <div>Sá</div>
                <div>Do</div>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell, idx) => {
                  const expDocs = getDocsExpiringOnDate(cell.date);
                  const isToday =
                    cell.date.getFullYear() === today.getFullYear() &&
                    cell.date.getMonth() === today.getMonth() &&
                    cell.date.getDate() === today.getDate();

                  const hasExpired = expDocs.some((d) => d.daysToExpire !== null && d.daysToExpire < 0);

                  return (
                    <div
                      key={idx}
                      title={
                        expDocs.length > 0
                          ? expDocs.map((d) => `${d.name} (${dueLabel(d.daysToExpire)})`).join('\n')
                          : undefined
                      }
                      className={cn(
                        'relative flex flex-col items-center justify-center h-8 rounded transition-all select-none',
                        cell.isCurrentMonth
                          ? 'text-xs font-semibold text-foreground'
                          : 'text-[10px] text-muted-foreground/30',
                        isToday && 'bg-primary text-primary-foreground font-black shadow-sm',
                        !isToday && expDocs.length > 0 && 'bg-accent/40 border border-border/60 hover:bg-accent/80',
                        !isToday && expDocs.length === 0 && 'hover:bg-accent/40',
                      )}
                    >
                      <span>{cell.dayNumber}</span>
                      {expDocs.length > 0 && !isToday && (
                        <span
                          className={cn(
                            'absolute bottom-0.5 size-1.5 rounded-full',
                            hasExpired ? 'bg-destructive animate-pulse' : 'bg-amber-500',
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* List side */}
            <div className="flex flex-col justify-between w-full sm:w-56 shrink-0 border-t sm:border-t-0 sm:border-l border-border pt-3 sm:pt-0 sm:pl-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Alertas Próximas ({total})
                </p>
                <ul className="flex flex-col gap-2">
                  {preview.map((doc) => (
                    <li key={doc.id} className="flex flex-col bg-accent/30 p-2 rounded-lg border border-border/30">
                      <span className="truncate text-xs font-semibold text-foreground">{doc.name}</span>
                      <span
                        className={cn(
                          'text-[10px] font-medium mt-0.5',
                          doc.daysToExpire !== null && doc.daysToExpire < 0
                            ? 'text-destructive'
                            : 'text-amber-600',
                        )}
                      >
                        {dueLabel(doc.daysToExpire)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link
                to="/perfil/documentos"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'mt-3 w-full text-xs font-semibold',
                )}
              >
                Mis documentos
              </Link>
            </div>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
