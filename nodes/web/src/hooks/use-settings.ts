import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getSettings, updateSettings } from '@/lib/api';
import type { UpdateSettingsInput, UserSettings } from '@/types/settings';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useSettings}. */
export interface UseSettingsResult {
  /** Ajustes propios del usuario, o `null` mientras no se hayan cargado. */
  settings: UserSettings | null;
  /** `true` mientras se carga la configuración inicial. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Vuelve a cargar los ajustes desde el backend. */
  refetch: () => Promise<void>;
  /**
   * Persiste un cambio parcial (PATCH). Actualiza el estado con la respuesta del
   * backend. Propaga el error al llamador para que la UI muestre feedback.
   */
  save: (patch: UpdateSettingsInput) => Promise<void>;
}

/**
 * Hook de datos de Configuración (§6-2.3). Envuelve `getSettings`/`updateSettings`
 * (JWT de sesión). El tema se aplica vía {@link useTheme}; este hook cubre
 * el resto de preferencias (notificaciones) pero refleja también `theme` para
 * mantener consistente la lectura. El cleanup ignora respuestas tras desmontar.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<UserSettings | null>(null);
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
      const data = await getSettings();
      if (mountedRef.current) setSettings(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar tu configuración.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (patch: UpdateSettingsInput) => {
    const data = await updateSettings(patch);
    if (mountedRef.current) setSettings(data);
  }, []);

  return { settings, loading, error, refetch: load, save };
}
