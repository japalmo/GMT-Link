import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getDashboard,
  saveDashboard as apiSaveDashboard,
} from '@/lib/api';
import type {
  AvailableWidget,
  DashboardLayoutItem,
} from '@/types/dashboard';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useDashboard}. */
export interface UseDashboardResult {
  /** Widgets disponibles para el usuario (ya filtrados por permiso). */
  widgets: AvailableWidget[];
  /** Layout reconciliado (orden + visibilidad), order 0..n-1. */
  layout: DashboardLayoutItem[];
  /** `true` mientras se carga la configuración inicial. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Vuelve a cargar widgets + layout desde el backend. */
  refetch: () => Promise<void>;
  /**
   * Persiste un layout nuevo (PUT). Actualiza el estado con la respuesta
   * reconciliada del backend. Propaga el error al llamador para que la UI
   * decida (p. ej. mantener el modo edición abierto).
   */
  save: (layout: DashboardLayoutItem[]) => Promise<void>;
}

/**
 * Hook de datos del Dashboard modular (§6-2.1).
 *
 * Envuelve `getDashboard`/`saveDashboard` (idToken de Firebase). El backend ya
 * filtra los widgets por permiso y reconcilia el layout (order 0..n-1), así que
 * el hook solo gestiona carga/error y refleja la respuesta de guardado. El
 * cálculo del DATO de cada widget vive en cada componente de widget, reusando
 * los endpoints existentes. El cleanup ignora respuestas que llegan tras
 * desmontar.
 */
export function useDashboard(): UseDashboardResult {
  const [widgets, setWidgets] = useState<AvailableWidget[]>([]);
  const [layout, setLayout] = useState<DashboardLayoutItem[]>([]);
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
      const data = await getDashboard();
      if (mountedRef.current) {
        setWidgets(data.widgets);
        setLayout(data.layout);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar tu dashboard.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (next: DashboardLayoutItem[]) => {
    const data = await apiSaveDashboard(next);
    if (mountedRef.current) {
      setWidgets(data.widgets);
      setLayout(data.layout);
    }
  }, []);

  return { widgets, layout, loading, error, refetch: load, save };
}
