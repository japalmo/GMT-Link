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

/** Opciones de {@link useOvertime}. */
export interface UseOvertimeOptions {
  /**
   * Tamaño de página de `mine`/`managerItems` (carga inicial y cada
   * `loadMore`). Default 30 (tope 100), igual que el resto de listados
   * paginados. Súbelo (p. ej. 100) cuando el consumidor necesita "prácticamente
   * todo" en una sola página (p. ej. la Vista general, que agrega client-side).
   */
  limit?: number;
}

/** Valor expuesto por {@link useOvertime}. */
export interface UseOvertimeResult {
  /** Solicitudes de horas extra propias del usuario (página actual, siempre cargadas). */
  mine: OvertimeView[];
  /** ¿Hay más páginas de `mine`? (`nextCursor != null`). */
  mineHasMore: boolean;
  /** Carga de una página siguiente de `mine` vía `loadMoreMine`. */
  loadingMoreMine: boolean;
  /** Carga y agrega la siguiente página de `mine` al final. */
  loadMoreMine: () => Promise<void>;
  /**
   * TODAS las solicitudes (solo si soy gestor; `[]` y silencioso si no). Cada
   * fila incluye `requester` para la vista de gestión.
   */
  managerItems: OvertimeView[];
  /** ¿Hay más páginas de `managerItems`? (`nextCursor != null`). */
  managerHasMore: boolean;
  /** Carga de una página siguiente de `managerItems` vía `loadMoreManager`. */
  loadingMoreManager: boolean;
  /** Carga y agrega la siguiente página de `managerItems` al final. */
  loadMoreManager: () => Promise<void>;
  /**
   * `true` si el probe de `GET /overtime` NO dio 403, es decir, el usuario puede
   * ver/decidir todas las solicitudes. La sección de gestión de la UI se monta
   * solo si esto es `true`.
   */
  isManager: boolean;
  /** `true` mientras se carga la información inicial (página 1 de ambas listas). */
  loading: boolean;
  /** Mensaje de error de la última carga de "mis horas extra", o `null`. */
  error: string | null;
  /** Vuelve a cargar la página 1 de mis solicitudes + (si soy gestor) la lista global. */
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
 * Idéntico a {@link useReimbursements} pero sin boleta. `mine` y `managerItems`
 * usan paginación KEYSET server-side (misma forma que `useAssets`): cada uno
 * expone su propia página actual + `hasMore`/`loadMore` ("Cargar más"). La
 * lista global de gestión se intenta con un probe silencioso: si `GET
 * /overtime` responde 403, el usuario no es gestor → `managerItems=[]`,
 * `isManager=false`, sin error (un 403 esperado no es un fallo de UI). Las
 * mutaciones refrescan la PÁGINA 1 de "lo mío" y, si soy gestor, de la lista
 * global. El cleanup ignora respuestas tras desmontar (mountedRef); `genRef`
 * descarta páginas de consultas ya obsoletas.
 */
export function useOvertime(opts: UseOvertimeOptions = {}): UseOvertimeResult {
  const { limit } = opts;

  const [mine, setMine] = useState<OvertimeView[]>([]);
  const [mineNextCursor, setMineNextCursor] = useState<string | null>(null);
  const [loadingMoreMine, setLoadingMoreMine] = useState(false);

  const [managerItems, setManagerItems] = useState<OvertimeView[]>([]);
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
        const page = await listAllOvertime({ limit });
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
      const page = await listMyOvertime({ limit });
      if (mountedRef.current && genRef.current === gen) {
        setMine(page.items);
        setMineNextCursor(page.nextCursor);
      }
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar tus horas extra.'));
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
      const page = await listMyOvertime({ limit, cursor: mineNextCursor });
      if (!mountedRef.current || genRef.current !== gen) return;
      setMine((prev) => [...prev, ...page.items]);
      setMineNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar más horas extra.'));
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
      const page = await listAllOvertime({ limit, cursor: managerNextCursor });
      if (!mountedRef.current || genRef.current !== gen) return;
      setManagerItems((prev) => [...prev, ...page.items]);
      setManagerNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar más horas extra.'));
      }
    } finally {
      if (mountedRef.current) setLoadingMoreManager(false); // guard de montaje solo (ver nota en use-users)
    }
  }, [managerNextCursor, loadingMoreManager, limit]);

  /** Refresca la página 1 de "lo mío" y, si soy gestor, de la lista global. */
  const refreshAll = useCallback(async () => {
    const gen = ++genRef.current;
    const page = await listMyOvertime({ limit });
    if (mountedRef.current && genRef.current === gen) {
      setMine(page.items);
      setMineNextCursor(page.nextCursor);
    }
    if (isManager) await loadManager(gen);
  }, [isManager, loadManager, limit]);

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
    approve,
    reject,
    pay,
  };
}
