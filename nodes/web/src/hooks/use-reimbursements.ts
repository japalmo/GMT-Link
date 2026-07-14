import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  approveReimbursement,
  attachReimbursementReceipt,
  createReimbursement,
  deleteReimbursement,
  listAllReimbursements,
  listMyReimbursements,
  payReimbursement,
  rejectReimbursement,
  updateReimbursement,
} from '@/lib/api';
import type { CreateReimbursementInput, ReimbursementView } from '@/types/finance';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Opciones de {@link useReimbursements}. */
export interface UseReimbursementsOptions {
  /**
   * Tamaño de página de `mine`/`managerItems` (carga inicial y cada
   * `loadMore`). Default 30 (tope 100), igual que el resto de listados
   * paginados. Súbelo (p. ej. 100) cuando el consumidor necesita "prácticamente
   * todo" en una sola página (p. ej. la Vista general, que agrega client-side).
   */
  limit?: number;
}

/** Valor expuesto por {@link useReimbursements}. */
export interface UseReimbursementsResult {
  /** Reembolsos propios del usuario (página actual, siempre cargados). */
  mine: ReimbursementView[];
  /** ¿Hay más páginas de `mine`? (`nextCursor != null`). */
  mineHasMore: boolean;
  /** Carga de una página siguiente de `mine` vía `loadMoreMine`. */
  loadingMoreMine: boolean;
  /** Carga y agrega la siguiente página de `mine` al final. */
  loadMoreMine: () => Promise<void>;
  /**
   * TODOS los reembolsos (solo si soy gestor; `[]` y silencioso si no). Cada fila
   * incluye `requester` para la vista de gestión.
   */
  managerItems: ReimbursementView[];
  /** ¿Hay más páginas de `managerItems`? (`nextCursor != null`). */
  managerHasMore: boolean;
  /** Carga de una página siguiente de `managerItems` vía `loadMoreManager`. */
  loadingMoreManager: boolean;
  /** Carga y agrega la siguiente página de `managerItems` al final. */
  loadMoreManager: () => Promise<void>;
  /**
   * `true` si el probe de `GET /reimbursements` NO dio 403, es decir, el usuario
   * puede ver/decidir todos los reembolsos. La sección de gestión de la UI se
   * monta solo si esto es `true`.
   */
  isManager: boolean;
  /** `true` mientras se carga la información inicial (página 1 de ambas listas). */
  loading: boolean;
  /** Mensaje de error de la última carga de "mis reembolsos", o `null`. */
  error: string | null;
  /** Vuelve a cargar la página 1 de mis reembolsos + (si soy gestor) la lista global. */
  refetch: () => Promise<void>;
  /**
   * Crea un reembolso propio con su boleta OBLIGATORIA (un solo paso, multipart) y
   * refresca. Devuelve la vista creada. Propaga el error al llamador.
   */
  create: (input: CreateReimbursementInput, file: File) => Promise<ReimbursementView>;
  /** Edita un reembolso propio (solo dueño, solo si PENDIENTE) y refresca. */
  update: (id: string, input: CreateReimbursementInput) => Promise<void>;
  /** Elimina un reembolso propio (solo dueño, solo si PENDIENTE) y refresca. */
  remove: (id: string) => Promise<void>;
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
 * `mine` y `managerItems` usan paginación KEYSET server-side (misma forma que
 * `useAssets`): cada uno expone su propia página actual + `hasMore`/`loadMore`
 * ("Cargar más"). La lista global de gestión se intenta con un probe silencioso:
 * si `GET /reimbursements` responde 403, el usuario no es gestor →
 * `managerItems=[]`, `isManager=false`, y NO se publica error (un 403 esperado
 * no es un fallo de UI). Cualquier otro error del probe tampoco rompe la carga
 * principal. Las mutaciones refrescan la PÁGINA 1 de "lo mío" y, si soy gestor,
 * de la lista global (se pierde lo acumulado por `loadMore`, igual que al
 * cambiar filtros en `useAssets`). El cleanup ignora respuestas tras desmontar
 * (mountedRef); `genRef` descarta páginas de consultas ya obsoletas.
 */
export function useReimbursements(opts: UseReimbursementsOptions = {}): UseReimbursementsResult {
  const { limit } = opts;

  const [mine, setMine] = useState<ReimbursementView[]>([]);
  const [mineNextCursor, setMineNextCursor] = useState<string | null>(null);
  const [loadingMoreMine, setLoadingMoreMine] = useState(false);

  const [managerItems, setManagerItems] = useState<ReimbursementView[]>([]);
  const [managerNextCursor, setManagerNextCursor] = useState<string | null>(null);
  const [loadingMoreManager, setLoadingMoreManager] = useState(false);

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

  // Descarta respuestas de `loadMore*` en vuelo cuando una recarga de página 1
  // (refetch/mutación) ya las volvió obsoletas.
  const genRef = useRef(0);

  /** Probe silencioso de la lista global: 403 = no gestor (sin error). */
  const loadManager = useCallback(
    async (gen: number) => {
      try {
        const page = await listAllReimbursements({ limit });
        if (!mountedRef.current || genRef.current !== gen) return;
        setManagerItems(page.items);
        setManagerNextCursor(page.nextCursor);
        setIsManager(true);
      } catch (err) {
        if (mountedRef.current && genRef.current === gen) {
          setManagerItems([]);
          setManagerNextCursor(null);
          setIsManager(false);
        }
        // 403 es esperado (no soy gestor). Otros errores se ignoran a propósito:
        // la sección de gestión simplemente no aparece; "lo mío" sigue vivo.
        if (!(err instanceof ApiError) || err.status !== 403) {
          // Silencioso por diseño; ver doc del hook.
        }
      }
    },
    [limit],
  );

  const load = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listMyReimbursements({ limit });
      if (mountedRef.current && genRef.current === gen) {
        setMine(page.items);
        setMineNextCursor(page.nextCursor);
      }
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar tus reembolsos.'));
      }
    } finally {
      if (mountedRef.current && genRef.current === gen) setLoading(false);
    }
    await loadManager(gen);
  }, [limit, loadManager]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Carga la siguiente página de "lo mío" y la agrega al final. */
  const loadMoreMine = useCallback(async () => {
    if (!mineNextCursor || loadingMoreMine) return;
    const gen = genRef.current;
    setLoadingMoreMine(true);
    try {
      const page = await listMyReimbursements({ limit, cursor: mineNextCursor });
      if (!mountedRef.current || genRef.current !== gen) return;
      setMine((prev) => [...prev, ...page.items]);
      setMineNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar más reembolsos.'));
      }
    } finally {
      if (mountedRef.current) setLoadingMoreMine(false); // guard de montaje solo (ver nota en use-users)
    }
  }, [mineNextCursor, loadingMoreMine, limit]);

  /** Carga la siguiente página de la lista global (gestor) y la agrega al final. */
  const loadMoreManager = useCallback(async () => {
    if (!managerNextCursor || loadingMoreManager) return;
    const gen = genRef.current;
    setLoadingMoreManager(true);
    try {
      const page = await listAllReimbursements({ limit, cursor: managerNextCursor });
      if (!mountedRef.current || genRef.current !== gen) return;
      setManagerItems((prev) => [...prev, ...page.items]);
      setManagerNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar más reembolsos.'));
      }
    } finally {
      if (mountedRef.current) setLoadingMoreManager(false); // guard de montaje solo (ver nota en use-users)
    }
  }, [managerNextCursor, loadingMoreManager, limit]);

  /** Refresca la página 1 de "lo mío" y, si soy gestor, de la lista global. */
  const refreshAll = useCallback(async () => {
    const gen = ++genRef.current;
    const page = await listMyReimbursements({ limit });
    if (mountedRef.current && genRef.current === gen) {
      setMine(page.items);
      setMineNextCursor(page.nextCursor);
    }
    if (isManager) await loadManager(gen);
  }, [isManager, loadManager, limit]);

  const create = useCallback(
    async (input: CreateReimbursementInput, file: File) => {
      const created = await createReimbursement(input, file);
      await refreshAll();
      return created;
    },
    [refreshAll],
  );

  const update = useCallback(
    async (id: string, input: CreateReimbursementInput) => {
      await updateReimbursement(id, input);
      await refreshAll();
    },
    [refreshAll],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteReimbursement(id);
      await refreshAll();
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
    mineHasMore: mineNextCursor !== null,
    loadingMoreMine,
    loadMoreMine,
    managerItems,
    managerHasMore: managerNextCursor !== null,
    loadingMoreManager,
    loadMoreManager,
    isManager,
    loading,
    error,
    refetch: load,
    create,
    update,
    remove,
    attachReceipt,
    approve,
    reject,
    pay,
  };
}
