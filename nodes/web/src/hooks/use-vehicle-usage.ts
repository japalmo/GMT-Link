import { useCallback, useEffect, useRef, useState } from 'react';

import { getAssetUsageStats } from '@/lib/api';
import type { UsoGranularidad, UsoVehiculoView } from '@/types/assets';

export interface FiltroUsoVehiculo {
  granularidad: UsoGranularidad;
  /** ISO-8601 solo fecha (AAAA-MM-DD), o `null` para no acotar ese extremo. */
  desde: string | null;
  hasta: string | null;
}

export interface UseVehicleUsage {
  datos: UsoVehiculoView | null;
  cargando: boolean;
  error: string | null;
  filtro: FiltroUsoVehiculo;
  setFiltro: (parcial: Partial<FiltroUsoVehiculo>) => void;
  recargar: () => void;
}

export const FILTRO_USO_INICIAL: FiltroUsoVehiculo = {
  granularidad: 'semana',
  desde: null,
  hasta: null,
};

/**
 * Uso de un vehículo (gráfico + métricas) con sus filtros.
 *
 * Cada cambio de filtro dispara una consulta nueva porque el backend hace el
 * recorte y la agrupación: traer todo y reagrupar en el navegador significaría
 * bajar cientos de checklists en cada carga de la pantalla.
 */
export function useVehicleUsage(assetId: string | null): UseVehicleUsage {
  const [datos, setDatos] = useState<UsoVehiculoView | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltroInterno] = useState<FiltroUsoVehiculo>(FILTRO_USO_INICIAL);

  // Contador de peticiones: si el usuario cambia el filtro dos veces seguidas,
  // la respuesta lenta de la primera no debe pisar a la de la segunda.
  const peticion = useRef(0);

  const cargar = useCallback(async () => {
    if (!assetId) {
      setDatos(null);
      return;
    }
    const mia = peticion.current + 1;
    peticion.current = mia;
    setCargando(true);
    setError(null);
    try {
      const res = await getAssetUsageStats(assetId, {
        granularidad: filtro.granularidad,
        ...(filtro.desde ? { desde: filtro.desde } : {}),
        // El backend filtra por `createdAt <= hasta`; sin hora, un "hasta" de
        // hoy dejaría fuera los checklists de hoy mismo.
        ...(filtro.hasta ? { hasta: `${filtro.hasta}T23:59:59.999Z` } : {}),
      });
      if (peticion.current === mia) setDatos(res);
    } catch (err) {
      if (peticion.current === mia) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el uso del vehículo.');
      }
    } finally {
      if (peticion.current === mia) setCargando(false);
    }
  }, [assetId, filtro.granularidad, filtro.desde, filtro.hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const setFiltro = useCallback((parcial: Partial<FiltroUsoVehiculo>) => {
    setFiltroInterno((prev) => ({ ...prev, ...parcial }));
  }, []);

  return { datos, cargando, error, filtro, setFiltro, recargar: () => void cargar() };
}
