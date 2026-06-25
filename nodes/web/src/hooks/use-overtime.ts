import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  approveOvertime,
  createOvertime,
  listAllOvertime,
  listMyOvertime,
  payOvertime,
  rejectOvertime,
} from '@/lib/api';
import type { CreateOvertimeInput, OvertimeView } from '@/types/finance';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useOvertime}. */
export interface UseOvertimeResult {
  /** Solicitudes de horas extra propias del usuario (siempre cargadas). */
  mine: OvertimeView[];
  /**
   * TODAS las solicitudes (solo si soy gestor; `[]` y silencioso si no). Cada
   * fila incluye `requester` para la vista de gestión.
   */
  managerItems: OvertimeView[];
  /**
   * `true` si el probe de `GET /overtime` NO dio 403, es decir, el usuario puede
   * ver/decidir todas las solicitudes. La sección de gestión de la UI se monta
   * solo si esto es `true`.
   */
  isManager: boolean;
  /** `true` mientras se carga la información inicial. */
  loading: boolean;
  /** Mensaje de error de la última carga de "mis horas extra", o `null`. */
  error: string | null;
  /** Vuelve a cargar mis solicitudes + (si soy gestor) la lista global. */
  refetch: () => Promise<void>;
  /** Crea una solicitud propia y refresca. Propaga el error al llamador. */
  create: (input: CreateOvertimeInput) => Promise<void>;
  /** Aprueba una solicitud (gestor) y refresca. */
  approve: (id: string) => Promise<void>;
  /** Rechaza una solicitud (gestor), con motivo opcional, y refresca. */
  reject: (id: string, reason?: string) => Promise<void>;
  /** Marca pagada una solicitud (gestor) y refresca. */
  pay: (id: string) => Promise<void>;
}

/**
 * Hook de datos de Horas extra (§6-3.3).
 *
 * Idéntico a {@link useReimbursements} pero sin boleta. Carga siempre "mis horas
 * extra". La lista global de gestión se intenta con un probe silencioso: si `GET
 * /overtime` responde 403, el usuario no es gestor → `managerItems=[]`,
 * `isManager=false`, sin error (un 403 esperado no es un fallo de UI). Las
 * mutaciones refrescan "lo mío" y, si soy gestor, la lista global. El cleanup
 * ignora respuestas tras desmontar (mountedRef).
 */
export function useOvertime(): UseOvertimeResult {
  const [mine, setMine] = useState<OvertimeView[]>([]);
  const [managerItems, setManagerItems] = useState<OvertimeView[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Probe silencioso de la lista global: 403 = no gestor (sin error). */
  const loadManager = useCallback(async () => {
    try {
      const list = await listAllOvertime({});
      if (mountedRef.current) {
        setManagerItems(list);
        setIsManager(true);
      }
    } catch (err) {
      if (mountedRef.current) {
        setManagerItems([]);
        setIsManager(false);
      }
      // 403 es esperado (no soy gestor). Otros errores se ignoran a propósito:
      // la sección de gestión simplemente no aparece; "lo mío" sigue vivo.
      if (!(err instanceof ApiError) || err.status !== 403) {
        // Silencioso por diseño; ver doc del hook.
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMyOvertime();
      if (mountedRef.current) setMine(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar tus horas extra.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    await loadManager();
  }, [loadManager]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Refresca "lo mío" y, si soy gestor, la lista global. */
  const refreshAll = useCallback(async () => {
    const list = await listMyOvertime();
    if (mountedRef.current) setMine(list);
    if (isManager) await loadManager();
  }, [isManager, loadManager]);

  const create = useCallback(
    async (input: CreateOvertimeInput) => {
      await createOvertime(input);
      await refreshAll();
    },
    [refreshAll],
  );

  const approve = useCallback(
    async (id: string) => {
      await approveOvertime(id);
      await refreshAll();
    },
    [refreshAll],
  );

  const reject = useCallback(
    async (id: string, reason?: string) => {
      await rejectOvertime(id, reason);
      await refreshAll();
    },
    [refreshAll],
  );

  const pay = useCallback(
    async (id: string) => {
      await payOvertime(id);
      await refreshAll();
    },
    [refreshAll],
  );

  return {
    mine,
    managerItems,
    isManager,
    loading,
    error,
    refetch: load,
    create,
    approve,
    reject,
    pay,
  };
}
