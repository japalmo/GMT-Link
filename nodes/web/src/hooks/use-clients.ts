import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import * as api from '@/lib/api';
import type { ClientView, CreateClientInput, UpdateClientInput } from '@/types/projects';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useClients} (Capa 1 de la jerarquía A0). */
export interface UseClientsResult {
  clients: ClientView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (dto: CreateClientInput) => Promise<ClientView>;
  update: (id: string, dto: UpdateClientInput) => Promise<ClientView>;
  remove: (id: string) => Promise<void>;
}

/**
 * Hook de datos del catálogo de Clientes (`GET /clients`). Sigue el patrón del
 * repo: `useState` + `useEffect(load)` + `useCallback` para create/update, que
 * recargan la lista tras mutar para mantener las métricas de card coherentes.
 */
export function useClients(): UseClientsResult {
  const [clients, setClients] = useState<ClientView[]>([]);
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
      const list = await api.listClients();
      if (mountedRef.current) setClients(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los clientes.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (dto: CreateClientInput) => {
      const c = await api.createClient(dto);
      await load();
      return c;
    },
    [load],
  );

  const update = useCallback(
    async (id: string, dto: UpdateClientInput) => {
      const c = await api.updateClient(id, dto);
      await load();
      return c;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteClient(id);
      await load();
    },
    [load],
  );

  return { clients, loading, error, refetch: load, create, update, remove };
}
