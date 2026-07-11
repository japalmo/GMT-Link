import type { ReactNode } from 'react';
import { useAuth } from '@/context/auth-context';

/** Props de {@link GatedAction}. */
export interface GatedActionProps {
  /** Permisos que habilitan la acción. Basta con tener uno (OR). */
  permissions: string[];
  /** Contenido a mostrar cuando el usuario tiene alguno de los `permissions`. */
  children: ReactNode;
  /** Contenido alternativo cuando NO tiene el permiso. Por defecto, nada. */
  fallback?: ReactNode;
}

/**
 * Envoltorio declarativo para ocultar acciones especiales (botones de crear
 * cliente/faena, gestionar equipo) a usuarios sin el permiso requerido (gating
 * de UI). Es puramente presentacional: la autorización real la aplica el backend.
 * Mientras la sesión carga (`user` null), `permissions` es `[]` → fail-closed.
 *
 * @example
 * <GatedAction permissions={['project:manage']}>
 *   <Button onClick={openCreate}>Nuevo cliente</Button>
 * </GatedAction>
 */
export function GatedAction({ permissions, children, fallback = null }: GatedActionProps) {
  const { user } = useAuth();
  const owned = new Set<string>(user?.permissions ?? []);
  const allowed = permissions.some((p) => owned.has(p));
  return <>{allowed ? children : fallback}</>;
}
