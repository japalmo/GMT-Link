import { useProfile } from '@/hooks/use-profile';

/**
 * Gating de demo por rol funcional. Devuelve `true` si el usuario autenticado
 * tiene AL MENOS uno de los `keys` indicados entre sus `roleKeys`.
 *
 * Nota de arquitectura: NO existe un cliente OpenFGA en el front (§ gating de
 * demo). El `AuthedUser` del `auth-context` (`GET /auth/me`) no incluye
 * `roleKeys`; estos viven en `ProfileMe` (`GET /profile/me`) y los expone
 * {@link useProfile}. Por eso este hook lee de `useProfile()` y no del
 * `auth-context`. Mientras el perfil carga, `roleKeys` es `[]` y el hook
 * devuelve `false` (fail-closed): los botones de creación quedan ocultos hasta
 * confirmar el rol, evitando parpadeos de UI que luego se ocultan.
 *
 * La autorización REAL la aplica el backend con OpenFGA en cada endpoint; este
 * hook solo decide qué acciones especiales (crear cliente/faena, gestionar
 * equipo) mostrar en la UI.
 */
export function useHasRole(keys: string[]): boolean {
  const { profile } = useProfile();
  const roleKeys = profile?.roleKeys ?? [];
  return keys.some((k) => roleKeys.includes(k));
}
