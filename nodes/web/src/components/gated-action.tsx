import type { ReactNode } from 'react';
import { useHasRole } from '@/hooks/use-has-role';

/** Props de {@link GatedAction}. */
export interface GatedActionProps {
  /** Roles que habilitan la acción. Basta con tener uno (OR). */
  roles: string[];
  /** Contenido a mostrar cuando el usuario tiene alguno de los `roles`. */
  children: ReactNode;
  /** Contenido alternativo cuando NO tiene el rol. Por defecto, nada. */
  fallback?: ReactNode;
}

/**
 * Envoltorio declarativo para ocultar acciones especiales (botones de crear
 * cliente/faena, gestionar equipo) a usuarios sin el rol requerido (gating de
 * demo, ver {@link useHasRole}). Es puramente presentacional: la autorización
 * real la aplica el backend con OpenFGA.
 *
 * @example
 * <GatedAction roles={['org_admin']}>
 *   <Button onClick={openCreate}>Nuevo cliente</Button>
 * </GatedAction>
 */
export function GatedAction({ roles, children, fallback = null }: GatedActionProps) {
  const allowed = useHasRole(roles);
  return <>{allowed ? children : fallback}</>;
}
