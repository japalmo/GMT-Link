import { useEffect, useRef, useState } from 'react';
import { listProjects } from '@/lib/api';
import type { FinanceProjectRef } from '@/types/finance';

/**
 * Proyectos para la Vista general y el filtro por proyecto/cliente de la tabla
 * histórica (§5.3). Usa `GET /projects` (lista completa) y los reduce a
 * `FinanceProjectRef` (id/nombre/cliente) para hidratar las filas de HE
 * client-side. Si `GET /projects` da 403 (sin acceso a operaciones), devuelve
 * `[]` en silencio: la Vista general sigue funcionando con proyecto "—".
 */
export function useFinanceProjects(): { projects: FinanceProjectRef[]; loading: boolean } {
  const [projects, setProjects] = useState<FinanceProjectRef[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const list = await listProjects();
        if (mountedRef.current) {
          setProjects(
            list.map((p) => ({
              id: p.id,
              name: p.name,
              clientId: p.clientId ?? p.client?.id ?? null,
              clientName: p.client?.name ?? null,
            })),
          );
        }
      } catch {
        if (mountedRef.current) setProjects([]);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { projects, loading };
}
