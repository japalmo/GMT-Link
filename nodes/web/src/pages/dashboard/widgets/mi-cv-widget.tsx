import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileUser } from 'lucide-react';
import { ApiError, getCv } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import type { CvView } from '@/types/cv';
import { WidgetShell } from './widget-shell';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Completitud aproximada del CV: resumen + 3 secciones con al menos una entrada. */
function completeness(cv: CvView): number {
  const checks = [
    Boolean(cv.summary && cv.summary.trim().length > 0),
    cv.experiences.length > 0,
    cv.education.length > 0,
    cv.certifications.length > 0,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

/**
 * Widget "Mi CV" (§6-2.1). Resume la completitud del CV propio (¿tiene resumen?,
 * cuántas entradas por sección) a partir de `GET /cv/me`.
 */
export function MiCvWidget(): ReactNode {
  const [cv, setCv] = useState<CvView | null>(null);
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
      const data = await getCv();
      if (mountedRef.current) setCv(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar tu CV.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pct = cv ? completeness(cv) : 0;
  const entries = cv
    ? cv.experiences.length + cv.education.length + cv.certifications.length
    : 0;

  return (
    <WidgetShell
      title="Mi CV"
      description="Completitud de tu hoja de vida"
      icon={FileUser}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight tabular-nums">
              {pct}%
            </span>
            <span className="text-xs text-muted-foreground">
              {entries} {entries === 1 ? 'entrada' : 'entradas'}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Completitud del CV"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {cv && cv.summary && cv.summary.trim().length > 0
              ? 'Resumen completado.'
              : 'Aún no agregas un resumen.'}
          </p>
        </div>
        <Link
          to="/perfil/cv"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {pct === 100 ? 'Ver mi CV' : 'Completar mi CV'}
        </Link>
      </div>
    </WidgetShell>
  );
}
