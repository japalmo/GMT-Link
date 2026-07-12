import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  approveReimbursement,
  attachReimbursementReceipt,
  createReimbursement,
  listAllReimbursements,
  listMyReimbursements,
  payReimbursement,
  rejectReimbursement,
} from '@/lib/api';
import type { CreateReimbursementInput, ReimbursementView } from '@/types/finance';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useReimbursements}. */
export interface UseReimbursementsResult {
  /** Reembolsos propios del usuario (siempre cargados). */
  mine: ReimbursementView[];
  /**
   * TODOS los reembolsos (solo si soy gestor; `[]` y silencioso si no). Cada fila
   * incluye `requester` para la vista de gestión.
   */
  managerItems: ReimbursementView[];
  /**
   * `true` si el probe de `GET /reimbursements` NO dio 403, es decir, el usuario
   * puede ver/decidir todos los reembolsos. La sección de gestión de la UI se
   * monta solo si esto es `true`.
   */
  isManager: boolean;
  /** `true` mientras se carga la información inicial. */
  loading: boolean;
  /** Mensaje de error de la última carga de "mis reembolsos", o `null`. */
  error: string | null;
  /** Vuelve a cargar mis reembolsos + (si soy gestor) la lista global. */
  refetch: () => Promise<void>;
  /**
   * Crea un reembolso propio y refresca. Devuelve la vista creada (para poder
   * adjuntarle la boleta a continuación). Propaga el error al llamador.
   */
  create: (input: CreateReimbursementInput) => Promise<ReimbursementView>;
  /** Adjunta/actualiza la boleta (solo dueño, solo si PENDIENTE) y refresca. */
  attachReceipt: (id: string, file: File) => Promise<void>;
  /** Aprueba un reembolso (gestor) y refresca. */
  approve: (id: string) => Promise<void>;
  /** Rechaza un reembolso (gestor), con motivo opcional, y refresca. */
  reject: (id: string, reason?: string) => Promise<void>;
  /** Marca pagado un reembolso (gestor) y refresca. */
  pay: (id: string) => Promise<void>;
}

/**
 * Hook de datos de Reembolsos (§6-3.1).
 *
 * Carga siempre "mis reembolsos". La lista global de gestión se intenta con un
 * probe silencioso: si `GET /reimbursements` responde 403, el usuario no es
 * gestor → `managerItems=[]`, `isManager=false`, y NO se publica error (un 403
 * esperado no es un fallo de UI). Cualquier otro error del probe tampoco rompe
 * la carga principal. Las mutaciones refrescan "lo mío" y, si soy gestor, la
 * lista global. El cleanup ignora respuestas tras desmontar (mountedRef).
 */
export function useReimbursements(): UseReimbursementsResult {
  const [mine, setMine] = useState<ReimbursementView[]>([]);
  const [managerItems, setManagerItems] = useState<ReimbursementView[]>([]);
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
      const list = await listAllReimbursements({});
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
      const list = await listMyReimbursements();
      if (mountedRef.current) setMine(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar tus reembolsos.'));
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
    const list = await listMyReimbursements();
    if (mountedRef.current) setMine(list);
    if (isManager) await loadManager();
  }, [isManager, loadManager]);

  const create = useCallback(
    async (input: CreateReimbursementInput) => {
      const created = await createReimbursement(input);
      await refreshAll();
      return created;
    },
    [refreshAll],
  );

  const attachReceipt = useCallback(
    async (id: string, file: File) => {
      await attachReimbursementReceipt(id, file);
      await refreshAll();
    },
    [refreshAll],
  );

  const approve = useCallback(
    async (id: string) => {
      await approveReimbursement(id);
      await refreshAll();
    },
    [refreshAll],
  );

  const reject = useCallback(
    async (id: string, reason?: string) => {
      await rejectReimbursement(id, reason);
      await refreshAll();
    },
    [refreshAll],
  );

  const pay = useCallback(
    async (id: string) => {
      await payReimbursement(id);
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
    attachReceipt,
    approve,
    reject,
    pay,
  };
}
