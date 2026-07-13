import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssignRoleInput, UserMembership } from '@gmt-platform/contracts';
import {
  ApiError,
  assignUserRole,
  createUser,
  importUsers,
  listUsers,
  removeUserRole,
  resendUserInvite,
  revokeUserInvite,
  revokeUserSessions,
  type CreateUserDto,
  type CreateUserResponse,
  type ImportUsersResponse,
  type UserListItem,
  type UserRolesResponse,
} from '@/lib/api';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useUsers}. */
export interface UseUsersResult {
  /** Items de las páginas ya cargadas (página 1 + los `loadMore` acumulados). */
  items: UserListItem[];
  /** Carga de la página 1 (cambio de búsqueda). */
  loading: boolean;
  /** Carga de una página siguiente vía `loadMore` (no bloquea la lista visible). */
  loadingMore: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** ¿Hay más páginas? (`nextCursor != null`). */
  hasMore: boolean;
  /** Carga y agrega la siguiente página al final de `items`. */
  loadMore: () => Promise<void>;
  /** Fija el término de búsqueda (debounce ~300ms) y reinicia a la página 1. */
  setSearch: (term: string) => void;
  /** Vuelve a cargar la página 1 respetando la búsqueda actual. */
  refetch: () => Promise<void>;
  /** Crea un usuario; devuelve la respuesta con la clave provisoria. */
  create: (dto: CreateUserDto) => Promise<CreateUserResponse>;
  /** Importa usuarios en lote; devuelve creados + errores por fila. */
  importRows: (rows: CreateUserDto[]) => Promise<ImportUsersResponse>;
  /** Asigna un rol a un usuario en un alcance concreto. */
  assignRole: (id: string, input: AssignRoleInput) => Promise<UserRolesResponse>;
  /** Quita la membership exacta (rol + alcance) de un usuario. */
  removeRole: (id: string, membership: UserMembership) => Promise<UserRolesResponse>;
  /**
   * Reenvía la invitación (regenera la clave provisoria) y recarga la lista.
   * Devuelve la nueva clave para mostrarla una única vez.
   */
  resendInvite: (id: string) => Promise<{ provisionalPassword: string }>;
  /** Revoca el acceso del usuario (suspende / revoca invitación) y recarga la lista. */
  revokeInvite: (id: string) => Promise<UserListItem>;
  /** Cierra las sesiones vivas del usuario (no cambia su estado). */
  revokeSessions: (id: string) => Promise<void>;
}

/** Opciones de {@link useUsers}. */
export interface UseUsersOptions {
  /**
   * Tamaño de página (carga inicial y cada `loadMore`). Default 30 (tope 100).
   * Súbelo (p. ej. 100) cuando el consumidor necesita "prácticamente todo" en
   * una sola página (p. ej. un `<select>` de responsables en Backlog).
   */
  limit?: number;
}

/**
 * Hook de datos de la página de administración de Usuarios (§6-1.1).
 *
 * Envuelve las funciones tipadas de `lib/api.ts` (que adjuntan el JWT de
 * sesión). El directorio se carga con paginación KEYSET server-side: `items`
 * expone la página 1 (+ lo acumulado por `loadMore`), `hasMore`/`loadMore`
 * habilitan "Cargar más", y `setSearch` empuja la búsqueda al servidor con
 * debounce (~300ms), reiniciando a la página 1. Las mutaciones (crear,
 * importar, asignar/quitar rol, reenviar invitación, revocar) recargan la
 * página 1 para reflejar el estado real del servidor.
 */
export function useUsers(opts: UseUsersOptions = {}): UseUsersResult {
  const { limit } = opts;
  const [items, setItems] = useState<UserListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Término de búsqueda (con debounce). Al cambiar se recarga la página 1.
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Generación de carga: cada recarga de página 1 la incrementa. `loadMore`
  // captura la generación vigente y descarta su respuesta si la búsqueda
  // cambió mientras estaba en vuelo (evita mezclar páginas de consultas
  // distintas).
  const genRef = useRef(0);

  // Debounce de la búsqueda (~300ms).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Carga la página 1 cada vez que cambia el término debounced.
  const loadFirstPage = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listUsers({ search: debouncedSearch || undefined, limit });
      if (!mountedRef.current || genRef.current !== gen) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudo cargar el directorio de usuarios.'));
      }
    } finally {
      if (mountedRef.current && genRef.current === gen) setLoading(false);
    }
  }, [debouncedSearch, limit]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // Carga la siguiente página (keyset con el cursor vigente) y la agrega al final.
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const gen = genRef.current;
    setLoadingMore(true);
    try {
      const page = await listUsers({ search: debouncedSearch || undefined, cursor: nextCursor, limit });
      // Si mientras tanto cambió la búsqueda (página 1 recargada), descartamos.
      if (!mountedRef.current || genRef.current !== gen) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar más usuarios.'));
      }
    } finally {
      // Reset con guard de montaje SOLO (no de generación): si una recarga de página 1
      // cambió genRef mientras este loadMore estaba en vuelo, el try ya descartó la
      // respuesta; igual hay que liberar el flag o el botón queda atascado en "Cargando".
      // Es seguro porque el guard inicial (if loadingMore return) impide dos en vuelo.
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, debouncedSearch, limit]);

  const setSearch = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const create = useCallback(
    async (dto: CreateUserDto): Promise<CreateUserResponse> => {
      const result = await createUser(dto);
      await loadFirstPage();
      return result;
    },
    [loadFirstPage],
  );

  const importRows = useCallback(
    async (rows: CreateUserDto[]): Promise<ImportUsersResponse> => {
      const result = await importUsers(rows);
      await loadFirstPage();
      return result;
    },
    [loadFirstPage],
  );

  const assignRole = useCallback(
    (id: string, input: AssignRoleInput): Promise<UserRolesResponse> => assignUserRole(id, input),
    [],
  );

  const removeRole = useCallback(
    (id: string, membership: UserMembership): Promise<UserRolesResponse> =>
      removeUserRole(id, membership),
    [],
  );

  const resendInvite = useCallback(
    async (id: string): Promise<{ provisionalPassword: string }> => {
      const result = await resendUserInvite(id);
      await loadFirstPage();
      return result;
    },
    [loadFirstPage],
  );

  const revokeInvite = useCallback(
    async (id: string): Promise<UserListItem> => {
      const result = await revokeUserInvite(id);
      await loadFirstPage();
      return result;
    },
    [loadFirstPage],
  );

  const revokeSessions = useCallback(
    async (id: string): Promise<void> => {
      // No cambia el estado del usuario; recargamos igual para reflejar cualquier
      // dato derivado y mantener la lista fresca.
      await revokeUserSessions(id);
      await loadFirstPage();
    },
    [loadFirstPage],
  );

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    setSearch,
    refetch: loadFirstPage,
    create,
    importRows,
    assignRole,
    removeRole,
    resendInvite,
    revokeInvite,
    revokeSessions,
  };
}
