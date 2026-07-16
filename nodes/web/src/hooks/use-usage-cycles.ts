import { useCallback } from 'react';
import {
  startUsageCycle,
  confirmUsageCycle,
  cancelUsageCycle,
  endUsageCycle,
  listUsageCycles,
  getUsageCycle,
} from '@/lib/api';
import type {
  ChecklistAnswer,
  ChecklistSignatureInput,
  EndUsageCycleInput,
  UsageCycleResult,
  UsageCycleView,
} from '@/types/assets';

/**
 * Funciones tipadas del ciclo de uso de activos (reportar -> checklist ->
 * en uso -> terminar). Envuelve `@/lib/api` sin duplicar lógica: cada componente
 * maneja su propio loading/error/toasts (mismo estilo que `use-assets`). No lleva
 * estado propio; es un envoltorio estable (todo `useCallback`).
 */
export interface UseUsageCyclesResult {
  /** Reporta uso (reclama el activo). Foto inicial opcional. */
  start: (id: string, photo?: File) => Promise<UsageCycleResult>;
  /** Firma el checklist inicial y confirma el ciclo (pasa a EN_CURSO). */
  confirm: (
    id: string,
    cycleId: string,
    templateId: string,
    answers: ChecklistAnswer[],
    signature?: ChecklistSignatureInput,
  ) => Promise<UsageCycleResult>;
  /** Cancela un ciclo EN_PREPARACION (el activo vuelve a DISPONIBLE). */
  cancel: (id: string, cycleId: string) => Promise<UsageCycleResult>;
  /** Termina el uso (GPS / estacionamiento / traspaso). Foto final opcional. */
  end: (
    id: string,
    cycleId: string,
    dto: EndUsageCycleInput,
    photo?: File,
  ) => Promise<UsageCycleResult>;
  /** Lista los ciclos de uso del activo (historial). */
  list: (id: string) => Promise<UsageCycleView[]>;
  /** Trae el detalle de un ciclo puntual. */
  get: (id: string, cycleId: string) => Promise<UsageCycleView>;
}

export function useUsageCycles(): UseUsageCyclesResult {
  const start = useCallback((id: string, photo?: File) => startUsageCycle(id, photo), []);

  const confirm = useCallback(
    (
      id: string,
      cycleId: string,
      templateId: string,
      answers: ChecklistAnswer[],
      signature?: ChecklistSignatureInput,
    ) => confirmUsageCycle(id, cycleId, templateId, answers, signature),
    [],
  );

  const cancel = useCallback((id: string, cycleId: string) => cancelUsageCycle(id, cycleId), []);

  const end = useCallback(
    (id: string, cycleId: string, dto: EndUsageCycleInput, photo?: File) =>
      endUsageCycle(id, cycleId, dto, photo),
    [],
  );

  const list = useCallback((id: string) => listUsageCycles(id), []);

  const get = useCallback((id: string, cycleId: string) => getUsageCycle(id, cycleId), []);

  return { start, confirm, cancel, end, list, get };
}
