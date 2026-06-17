import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  approvePermissionRequest,
  createPermissionRequest,
  listMyPermissionRequests,
  listPendingPermissionRequests,
  rejectPermissionRequest,
} from '@/lib/api';
import type { RoleKey } from '@gmt-link/shared-types';
import type {
  PermissionRequestAdminView,
  PermissionRequestView,
} from '@/types/settings';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link usePermissionRequests}. */
export interface UsePermissionRequestsResult {
  /** Solicitudes de acceso propias del usuario (todas, cualquier estado). */
  mine: PermissionRequestView[];
  /** Pendientes de todos (solo si soy admin; `[]` y silencioso si no). */
  pending: PermissionRequestAdminView[];
  /**
   * `true` si el probe de `GET /permission-requests` NO dio 403, es decir, el
   * usuario puede ver/decidir solicitudes pendientes. La sección de admin de la
   * UI se monta solo si esto es `true`.
   */
  isAdmin: boolean;
  /** `true` mientras se carga la información inicial. */
  loading: boolean;
  /** Mensaje de error de la última carga de "mis solicitudes", o `null`. */
  error: string | null;
  /** Vuelve a cargar mis solicitudes + (si soy admin) las pendientes. */
  refetch: () => Promise<void>;
  /**
   * Crea una solicitud de acceso a un rol. Refresca "mis solicitudes" al éxito.
   * Propaga el error (p. ej. 409 "ya tienes una pendiente") para que la UI
   * muestre el mensaje del backend.
   */
  create: (roleKey: RoleKey, reason?: string) => Promise<void>;
  /** Aprueba una solicitud pendiente (admin) y refresca. */
  approve: (id: string) => Promise<void>;
  /** Rechaza una solicitud pendiente (admin), con motivo opcional, y refresca. */
  reject: (id: string, reason?: string) => Promise<void>;
}

/**
 * Hook de datos de Solicitudes de acceso (§6-2.3).
 *
 * Carga siempre "mis solicitudes". Las pendientes de todos se intentan cargar
 * con un probe silencioso: si `GET /permission-requests` responde 403, el
 * usuario no es admin → `pending=[]`, `isAdmin=false`, y NO se publica error
 * (un 403 esperado no es un fallo de UI). Cualquier otro error del probe
 * tampoco rompe la carga principal. El cleanup ignora respuestas tras desmontar.
 */
export function usePermissionRequests(): UsePermissionRequestsResult {
  const [mine, setMine] = useState<PermissionRequestView[]>([]);
  const [pending, setPending] = useState<PermissionRequestAdminView[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Probe silencioso de las pendientes: 403 = no admin (sin error). */
  const loadPending = useCallback(async () => {
    try {
      const list = await listPendingPermissionRequests();
      if (mountedRef.current) {
        setPending(list);
        setIsAdmin(true);
      }
    } catch (err) {
      if (mountedRef.current) {
        setPending([]);
        setIsAdmin(false);
      }
      // 403 es esperado (no soy admin). Otros errores se ignoran a propósito:
      // la sección admin simplemente no aparece; "mis solicitudes" sigue viva.
      if (!(err instanceof ApiError) || err.status !== 403) {
        // Silencioso por diseño; ver doc del hook.
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMyPermissionRequests();
      if (mountedRef.current) setMine(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar tus solicitudes de acceso.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    await loadPending();
  }, [loadPending]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (roleKey: RoleKey, reason?: string) => {
      await createPermissionRequest(roleKey, reason);
      const list = await listMyPermissionRequests();
      if (mountedRef.current) setMine(list);
    },
    [],
  );

  const approve = useCallback(
    async (id: string) => {
      await approvePermissionRequest(id);
      await loadPending();
    },
    [loadPending],
  );

  const reject = useCallback(
    async (id: string, reason?: string) => {
      await rejectPermissionRequest(id, reason);
      await loadPending();
    },
    [loadPending],
  );

  return {
    mine,
    pending,
    isAdmin,
    loading,
    error,
    refetch: load,
    create,
    approve,
    reject,
  };
}
