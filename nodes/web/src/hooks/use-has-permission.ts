import { useAuth } from '@/context/auth-context';

/**
 * Gating por permiso (contrato compartido §3.2). Devuelve `true` si el usuario
 * autenticado tiene `permission` entre sus `permissions` (derivados de sus roles
 * en `GET /auth/me`). Mientras la sesión carga (`user` null) → `false`
 * (fail-closed): los controles quedan ocultos hasta confirmar el permiso.
 *
 * La autorización REAL la aplica el backend en cada endpoint; este hook solo
 * decide visibilidad de UI.
 */
export function useHasPermission(permission: string): boolean {
  const { user } = useAuth();
  return (user?.permissions ?? []).includes(permission);
}
