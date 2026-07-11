import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';

/**
 * Guard de sección por MÓDULO (spec §3.2). Si el usuario entra por URL a una
 * sección cuyo módulo no está en `user.modules`, redirige a Inicio. Mientras la
 * sesión carga (`user` null) deja pasar: `ProtectedRoute` ya cubrió el gate de
 * sesión aguas arriba, y `modules` llega junto con el usuario.
 */
export function RequireModule({ module, children }: { module: string; children: ReactNode }) {
  const { user } = useAuth();
  if (user && !user.modules.includes(module)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Guard de sección por PERMISO. Redirige a Inicio si falta el permiso. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { user } = useAuth();
  if (user && !user.permissions.includes(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
