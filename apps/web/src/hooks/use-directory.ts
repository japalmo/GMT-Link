import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectoryEntry } from '@gmt-link/shared-types';
import { ApiError, listDirectory } from '@/lib/api';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useDirectory}. */
export interface UseDirectoryResult {
  /** Entradas del directorio cargadas y scopeadas por el backend. */
  entries: DirectoryEntry[];
  /** `true` mientras se carga / recarga el directorio. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Vuelve a cargar el directorio (sin búsqueda; la búsqueda es client-side). */
  refetch: () => Promise<void>;
}

/**
 * Hook de datos del Directorio (§6-1.6).
 *
 * Trae todas las entradas visibles para el usuario (el scoping por permisos lo
 * resuelve el backend) y delega la búsqueda al cliente vía `RoleScopedList`, por
 * lo que no recibe `search`. Gestiona loading/error y expone `refetch`. El
 * cleanup ignora respuestas que llegan tras desmontar.
 */
export function useDirectory(): UseDirectoryResult {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
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
      const data = await listDirectory();
      if (mountedRef.current) setEntries(data);
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

  return { entries, loading, error, refetch: load };
}
