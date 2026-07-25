import { useEffect, useRef, useState } from 'react';
import {
  fetchOvertimeFilterOptions,
  fetchReimbursementFilterOptions,
  type FinanceFilterOption,
} from '@/lib/api';

/** Opciones de filtro cargadas (vacías si no es gestor o aún no cargó). */
export interface FinanceFilterOptionsState {
  workers: FinanceFilterOption[];
  projects: FinanceFilterOption[];
  clients: FinanceFilterOption[];
}

const EMPTY: FinanceFilterOptionsState = { workers: [], projects: [], clients: [] };

/**
 * Carga las opciones de los filtros de la tabla de Gestión (trabajadores, proyectos
 * y clientes que YA aparecen en las solicitudes) desde el endpoint del módulo. Solo
 * consulta si `enabled` (el usuario es gestor); un error o 403 deja las opciones
 * vacías en silencio (los desplegables quedan sin opciones, sin romper la vista).
 * Los reembolsos solo devuelven `workers` (no tienen proyecto ni cliente).
 */
export function useFinanceFilterOptions(
  module: 'overtime' | 'reimbursements',
  enabled: boolean,
): FinanceFilterOptionsState {
  const [state, setState] = useState<FinanceFilterOptionsState>(EMPTY);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setState(EMPTY);
      return () => {
        mountedRef.current = false;
      };
    }
    void (async () => {
      try {
        if (module === 'overtime') {
          const r = await fetchOvertimeFilterOptions();
          if (mountedRef.current) {
            setState({ workers: r.workers, projects: r.projects, clients: r.clients });
          }
        } else {
          const r = await fetchReimbursementFilterOptions();
          if (mountedRef.current) setState({ workers: r.workers, projects: [], clients: [] });
        }
      } catch {
        if (mountedRef.current) setState(EMPTY);
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [module, enabled]);

  return state;
}
