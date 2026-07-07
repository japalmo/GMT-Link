import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import * as api from '@/lib/api';
import type { FaenaView, CreateFaenaInput } from '@/types/projects';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useFaenas} (Capa 2 de la jerarquía A0). */
export interface UseFaenasResult {
  faenas: FaenaView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (dto: CreateFaenaInput) => Promise<FaenaView>;
  update: (faenaId: string, dto: Partial<CreateFaenaInput>) => Promise<FaenaView>;
}

/**
 * Hook de datos de las Faenas de un cliente (`GET /clients/:clientId/faenas`,
 * lectura abierta). Se recarga cuando cambia `clientId`. Si `clientId` es
 * `undefined` (aún no resuelto por el router), no dispara la carga y deja la
 * lista vacía sin error.
 */
export function useFaenas(clientId: string | undefined): UseFaenasResult {
  const [faenas, setFaenas] = useState<FaenaView[]>([]);
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
    if (!clientId) {
      setFaenas([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.listFaenas(clientId);
      if (mountedRef.current) setFaenas(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar las faenas.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (dto: CreateFaenaInput) => {
      if (!clientId) throw new Error('No hay cliente seleccionado.');
      const f = await api.createFaena(clientId, dto);
      await load();
      return f;
    },
    [clientId, load],
  );

  const update = useCallback(
    async (faenaId: string, dto: Partial<CreateFaenaInput>) => {
      const f = await api.updateFaena(faenaId, dto);
      await load();
      return f;
    },
    [load],
  );

  return { faenas, loading, error, refetch: load, create, update };
}
