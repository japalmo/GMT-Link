import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoleKey } from '@gmt-platform/contracts';
import {
  ApiError,
  assignUserRole,
  createUser,
  importUsers,
  listUsers,
  removeUserRole,
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
  /** Directorio de usuarios cargado (orden createdAt desc del backend). */
  users: UserListItem[];
  /** `true` mientras se carga / recarga el directorio. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Vuelve a cargar el directorio respetando el `search` actual. */
  refetch: () => Promise<void>;
  /** Crea un usuario; devuelve la respuesta con la clave provisoria. */
  create: (dto: CreateUserDto) => Promise<CreateUserResponse>;
  /** Importa usuarios en lote; devuelve creados + errores por fila. */
  importRows: (rows: CreateUserDto[]) => Promise<ImportUsersResponse>;
  /** Asigna un rol a un usuario. */
  assignRole: (id: string, roleKey: RoleKey) => Promise<UserRolesResponse>;
  /** Quita un rol a un usuario. */
  removeRole: (id: string, roleKey: RoleKey) => Promise<UserRolesResponse>;
}

/**
 * Hook de datos de la página de administración de Usuarios (§6-1.1).
 *
 * Envuelve las funciones tipadas de `lib/api.ts` (que adjuntan el idToken de
 * Firebase). Gestiona los estados loading/error de la carga del directorio y
 * expone `refetch` además de los mutadores (create/import/assign/remove). Las
 * mutaciones propagan el error al llamador para que la UI muestre feedback
 * contextual (409/404/etc.); no tocan el estado de error de la lista.
 *
 * @param search - Término de búsqueda opcional; al cambiar, recarga la lista.
 */
export function useUsers(search?: string): UseUsersResult {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mantiene el search más reciente disponible para `refetch` sin recrearlo.
  const searchRef = useRef(search);
  searchRef.current = search;

  // Evita aplicar respuestas que llegan tras desmontar el componente.
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
      const data = await listUsers(searchRef.current);
      if (mountedRef.current) setUsers(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar el directorio de usuarios.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Carga inicial y recarga cuando cambia el término de búsqueda.
  useEffect(() => {
    void load();
  }, [load, search]);

  const create = useCallback(
    (dto: CreateUserDto): Promise<CreateUserResponse> => createUser(dto),
    [],
  );

  const importRows = useCallback(
    (rows: CreateUserDto[]): Promise<ImportUsersResponse> => importUsers(rows),
    [],
  );

  const assignRole = useCallback(
    (id: string, roleKey: RoleKey): Promise<UserRolesResponse> =>
      assignUserRole(id, roleKey),
    [],
  );

  const removeRole = useCallback(
    (id: string, roleKey: RoleKey): Promise<UserRolesResponse> =>
      removeUserRole(id, roleKey),
    [],
  );

  return {
    users,
    loading,
    error,
    refetch: load,
    create,
    importRows,
    assignRole,
    removeRole,
  };
}
