import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { errorToMessage, listUsers } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import { WidgetShell } from './widget-shell';

/**
 * Widget "Usuarios" (§6-2.1). Solo aparece para admins (el backend lo filtra por
 * permiso). Su dato es el total de usuarios de la organización, calculado en el
 * front contando `GET /users`.
 */
export function UsuariosTotalWidget(): ReactNode {
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
      // `listUsers` está paginado (keyset, tope 100/página): para un TOTAL exacto
      // se recorren todas las páginas acumulando el conteo, no solo la primera.
      let total = 0;
      let cursor: string | undefined;
      do {
        const page = await listUsers({ limit: 100, cursor });
        total += page.items.length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      if (mountedRef.current) setCount(total);
    } catch (err) {
      if (mountedRef.current) {
        setError(errorToMessage(err, 'No se pudo cargar el total de usuarios.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <WidgetShell
      title="Usuarios"
      description="Total de la organización"
      icon={Users}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-3">
        <p className="text-3xl font-bold tracking-tight tabular-nums">{count ?? 0}</p>
        <Link
          to="/usuarios"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Administrar usuarios
        </Link>
      </div>
    </WidgetShell>
  );
}
