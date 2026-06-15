import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { ApiError, listDocuments } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
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
 * pronto (`GET /documents/me?expiring=true`) y muestra el conteo + una lista
 * breve de los más próximos.
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

  return (
    <WidgetShell
      title="Mis documentos por vencer"
      description="Próximos 30 días"
      icon={CalendarClock}
      loading={loading}
      error={error}
      onRetry={load}
    >
      {total === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
            Sin documentos por vencer.
          </p>
          <Link
            to="/perfil/documentos"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Ir a mis documentos
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-3xl font-bold tracking-tight tabular-nums">
            {total}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              {total === 1 ? 'documento' : 'documentos'}
            </span>
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {preview.map((doc) => (
              <li key={doc.id} className="flex flex-col py-1.5 first:pt-0">
                <span className="truncate text-sm font-medium">{doc.name}</span>
                <span
                  className={
                    doc.daysToExpire !== null && doc.daysToExpire < 0
                      ? 'text-xs text-destructive'
                      : 'text-xs text-amber-600'
                  }
                >
                  {dueLabel(doc.daysToExpire)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/perfil/documentos"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {total > preview.length ? 'Ver todos' : 'Ir a mis documentos'}
          </Link>
        </div>
      )}
    </WidgetShell>
  );
}
