import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Contact } from 'lucide-react';
import { ApiError, listDirectory } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import { WidgetShell } from './widget-shell';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/**
 * Widget "Directorio" (§6-2.1). Cuenta las personas visibles para el usuario
 * (el backend ya scopea `GET /directory` por permisos) y ofrece un acceso
 * rápido a la página completa.
 */
export function DirectorioWidget(): ReactNode {
  const [count, setCount] = useState<number | null>(null);
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
      const entries = await listDirectory();
      if (mountedRef.current) setCount(entries.length);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar el directorio.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const personas = count ?? 0;

  return (
    <WidgetShell
      title="Directorio"
      description="Personas que puedes ver"
      icon={Contact}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-3">
        <p className="text-3xl font-bold tracking-tight tabular-nums">
          {personas}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {personas === 1 ? 'persona' : 'personas'}
          </span>
        </p>
        <Link
          to="/directorio"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Ver directorio
        </Link>
      </div>
    </WidgetShell>
  );
}
