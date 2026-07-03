import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CloneRoleResponse,
  CreateRoleInput,
  PermissionCatalogGroup,
  RoleDetail,
  UpdateRoleInput,
} from '@gmt-platform/contracts';
import {
  ApiError,
  cloneRole as apiCloneRole,
  createRole as apiCreateRole,
  deleteRole as apiDeleteRole,
  getPermissionsCatalog,
  getRole as apiGetRole,
  listRoles,
  updateRole as apiUpdateRole,
} from '@/lib/api';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useRoles}. */
export interface UseRolesResult {
  /** Catálogo de permisos agrupado por módulo. */
  catalog: PermissionCatalogGroup[];
  /** Todos los roles (sin separar). */
  roles: RoleDetail[];
  /** Roles del sistema (`isSystem=true`) — solo lectura + clonar. */
  systemRoles: RoleDetail[];
  /** Roles personalizados (`isSystem=false`) — CRUD completo. */
  customRoles: RoleDetail[];
  /** `true` mientras se carga catálogo + roles. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null`. */
  error: string | null;
  /** Recarga catálogo + roles. */
  refetch: () => Promise<void>;
  /** Trae el detalle actualizado de un rol (para abrir el editor con datos frescos). */
  getRole: (key: string) => Promise<RoleDetail>;
  /** Crea un rol personalizado y refresca la lista. */
  createRole: (input: CreateRoleInput) => Promise<RoleDetail>;
  /** Edita un rol personalizado y refresca la lista. */
  updateRole: (key: string, input: UpdateRoleInput) => Promise<RoleDetail>;
  /** Elimina un rol y refresca la lista. */
  deleteRole: (key: string) => Promise<void>;
  /**
   * Clona cualquier rol (incluso del sistema) a uno personalizado nuevo y
   * refresca la lista. Devuelve el `CloneRoleResponse` completo para que la UI
   * muestre los `omittedPermissionKeys` (grants no componibles filtrados — A7).
   */
  cloneRole: (key: string, label: string) => Promise<CloneRoleResponse>;
}

/**
 * Hook de datos de la página `/roles` (§Fase 5 — matriz RBAC). Envuelve el
 * catálogo de permisos y el CRUD de roles de `lib/api.ts`. Cada mutación
 * refresca la lista para reflejar el estado real del backend (incluye
 * `resyncRole` disparado del lado del servidor).
 */
export function useRoles(): UseRolesResult {
  const [catalog, setCatalog] = useState<PermissionCatalogGroup[]>([]);
  const [roles, setRoles] = useState<RoleDetail[]>([]);
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
      const [catalogData, rolesData] = await Promise.all([getPermissionsCatalog(), listRoles()]);
      if (mountedRef.current) {
        setCatalog(catalogData);
        setRoles(rolesData);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los roles.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getRole = useCallback((key: string): Promise<RoleDetail> => apiGetRole(key), []);

  const createRole = useCallback(
    async (input: CreateRoleInput): Promise<RoleDetail> => {
      const created = await apiCreateRole(input);
      await load();
      return created;
    },
    [load],
  );

  const updateRole = useCallback(
    async (key: string, input: UpdateRoleInput): Promise<RoleDetail> => {
      const updated = await apiUpdateRole(key, input);
      await load();
      return updated;
    },
    [load],
  );

  const deleteRole = useCallback(
    async (key: string): Promise<void> => {
      await apiDeleteRole(key);
      await load();
    },
    [load],
  );

  const cloneRole = useCallback(
    async (key: string, label: string): Promise<CloneRoleResponse> => {
      const cloned = await apiCloneRole(key, label);
      await load();
      return cloned;
    },
    [load],
  );

  return {
    catalog,
    roles,
    systemRoles: roles.filter((r) => r.isSystem),
    customRoles: roles.filter((r) => !r.isSystem),
    loading,
    error,
    refetch: load,
    getRole,
    createRole,
    updateRole,
    deleteRole,
    cloneRole,
  };
}
