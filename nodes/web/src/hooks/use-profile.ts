import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailKind, ProfileMe, UpdateProfileInput } from '@gmt-platform/contracts';
import {
  ApiError,
  changePassword as apiChangePassword,
  confirmEmailChange as apiConfirmEmailChange,
  requestEmailChange as apiRequestEmailChange,
  requestPasswordChange as apiRequestPasswordChange,
  getProfile,
  updateProfile,
} from '@/lib/api';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useProfile}. */
export interface UseProfileResult {
  /** Perfil propio cargado, o `null` mientras no haya respuesta exitosa. */
  profile: ProfileMe | null;
  /** `true` mientras se carga / recarga el perfil. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Vuelve a cargar el perfil desde el backend. */
  refetch: () => Promise<void>;
  /** Persiste cambios del perfil y refresca el estado local con la respuesta. */
  save: (input: UpdateProfileInput) => Promise<ProfileMe>;
  /**
   * Cambia la contraseña (endurecido): exige la contraseña actual, la nueva
   * (mín. 8) y el OTP enviado por {@link requestPasswordChange}. Nunca se registra.
   */
  changePassword: (
    currentPassword: string,
    newPassword: string,
    code: string,
  ) => Promise<void>;
  /** Envía un OTP al correo verificado del usuario (paso previo a cambiar la clave). */
  requestPasswordChange: () => Promise<void>;
  /** Envía un OTP al `newEmail` para verificarlo antes de aplicarlo al campo `kind`. */
  requestEmailChange: (newEmail: string, kind: EmailKind) => Promise<void>;
  /**
   * Confirma el cambio de correo con el OTP y refresca el estado local con el
   * perfil ya actualizado que devuelve el backend.
   */
  confirmEmailChange: (code: string) => Promise<ProfileMe>;
}

/**
 * Hook de datos de la página de Perfil → "Mis datos" (§6-1.3).
 *
 * Envuelve las funciones tipadas de `lib/api.ts` (que adjuntan el JWT de
 * sesión). Gestiona loading/error de la carga del perfil y expone `refetch`.
 * `save` actualiza el estado local con el perfil devuelto por el backend para
 * que la UI quede consistente sin recargar. Las mutaciones propagan el error al
 * llamador para que el formulario muestre feedback contextual.
 */
export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<ProfileMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const data = await getProfile();
      if (mountedRef.current) setProfile(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar tu perfil.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (input: UpdateProfileInput): Promise<ProfileMe> => {
    const updated = await updateProfile(input);
    if (mountedRef.current) setProfile(updated);
    return updated;
  }, []);

  const changePassword = useCallback(
    (currentPassword: string, newPassword: string, code: string): Promise<void> =>
      apiChangePassword(currentPassword, newPassword, code),
    [],
  );

  const requestPasswordChange = useCallback(
    (): Promise<void> => apiRequestPasswordChange(),
    [],
  );

  const requestEmailChange = useCallback(
    (newEmail: string, kind: EmailKind): Promise<void> =>
      apiRequestEmailChange(newEmail, kind),
    [],
  );

  const confirmEmailChange = useCallback(
    async (code: string): Promise<ProfileMe> => {
      const updated = await apiConfirmEmailChange(code);
      if (mountedRef.current) setProfile(updated);
      return updated;
    },
    [],
  );

  return {
    profile,
    loading,
    error,
    refetch: load,
    save,
    changePassword,
    requestPasswordChange,
    requestEmailChange,
    confirmEmailChange,
  };
}
