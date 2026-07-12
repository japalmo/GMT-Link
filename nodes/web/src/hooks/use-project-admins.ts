import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import * as api from '@/lib/api';
import type { ProjectAdminOption } from '@/types/projects';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useProjectAdmins}. */
export interface UseProjectAdminsResult {
  admins: ProjectAdminOption[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook de los usuarios con permiso de administrador de proyecto
 * (`GET /users/project-admins`). Alimenta el selector "Administrador de
 * proyecto" del wizard de creación (Capa 3). Sigue el patrón del repo:
 * `useState` + `useEffect(load)` con guardia de montaje.
 */
export function useProjectAdmins(): UseProjectAdminsResult {
  const [admins, setAdmins] = useState<ProjectAdminOption[]>([]);
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
      const list = await api.getProjectAdmins();
      if (mountedRef.current) setAdmins(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los administradores de proyecto.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { admins, loading, error, refetch: load };
}
