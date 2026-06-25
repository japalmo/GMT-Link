import { useCallback, useMemo, useState } from 'react';
import type { ApprovalItem, ApprovalStatus } from './types';

/**
 * Resultado de un callback de transición. Puede ser síncrono (`void`) o
 * asíncrono (`Promise<void>`). Si lanza, la transición se aborta y el estado no
 * cambia (el consumidor recibe el error para mostrarlo).
 */
type MaybeAsync = void | Promise<void>;

/**
 * Configuración del hook `useApprovalWorkflow`.
 *
 * @typeParam T - Forma del contenido versionado que se aprueba.
 */
export interface UseApprovalWorkflowOptions<T> {
  /** Item inicial. Su `status` define el estado de arranque de la máquina. */
  readonly initialItem: ApprovalItem<T>;
  /**
   * Si el usuario actual puede aprobar/rechazar. Lo calcula el consumidor vía
   * OpenFGA (§3.1) — la primitiva nunca decide permisos por su cuenta.
   * @defaultValue false
   */
  readonly canApprove?: boolean;
  /** Se invoca tras CUALQUIER transición exitosa con el item resultante. */
  readonly onChange?: (item: ApprovalItem<T>) => MaybeAsync;
  /** Se invoca al aprobar, después de aplicar la transición. */
  readonly onApprove?: (item: ApprovalItem<T>) => MaybeAsync;
  /** Se invoca al rechazar, después de aplicar la transición. */
  readonly onReject?: (item: ApprovalItem<T>) => MaybeAsync;
  /**
   * Gancho de notificación al aprobador. Se dispara cuando el item pasa a
   * PENDIENTE (vía `submit`). La notificación real es backend; aquí es el gancho.
   */
  readonly onNotify?: (item: ApprovalItem<T>) => MaybeAsync;
}

/**
 * API que expone el hook. Las transiciones son asíncronas: esperan a sus
 * callbacks y propagan errores para que el consumidor los muestre.
 *
 * @typeParam T - Forma del contenido versionado que se aprueba.
 */
export interface UseApprovalWorkflow<T> {
  /** Item actual gestionado en memoria. */
  readonly item: ApprovalItem<T>;
  /** Si el usuario actual puede aprobar/rechazar (eco de la opción). */
  readonly canApprove: boolean;
  /**
   * Envía una nueva versión: crea un item PENDIENTE con `next` como `current` y
   * conserva el `current` previo en `previous`. Dispara `onNotify` y `onChange`.
   */
  readonly submit: (next: T, submittedBy?: string) => Promise<void>;
  /**
   * Aprueba la versión pendiente. Guarda el `current` en `previous`, pasa a
   * APROBADO y registra revisor + timestamp. Requiere `canApprove`.
   */
  readonly approve: (reviewer: string) => Promise<void>;
  /**
   * Rechaza la versión pendiente con un motivo obligatorio. Guarda el `current`
   * en `previous`, pasa a RECHAZADO y registra revisor + timestamp.
   * Requiere `canApprove`.
   */
  readonly reject: (reviewer: string, reason: string) => Promise<void>;
}

/** Estado en el que tiene sentido revisar (aprobar/rechazar). */
function isReviewable(status: ApprovalStatus): boolean {
  return status === 'PENDIENTE';
}

/**
 * Hook genérico que gestiona la máquina de estados de aprobación en memoria con
 * callbacks inyectables. No reimplementa permisos ni notificaciones: recibe
 * `canApprove` y expone `onNotify` como gancho.
 *
 * Reglas de transición:
 * - `submit(next)`: cualquier estado → PENDIENTE. `previous = current`,
 *   `current = next`. Limpia revisor/motivo. Dispara `onNotify`.
 * - `approve(reviewer)`: PENDIENTE → APROBADO. `previous = current`. Requiere
 *   `canApprove`.
 * - `reject(reviewer, reason)`: PENDIENTE → RECHAZADO. `previous = current`.
 *   Requiere `canApprove` y un motivo no vacío.
 *
 * @typeParam T - Forma del contenido versionado que se aprueba.
 */
export function useApprovalWorkflow<T>(
  options: UseApprovalWorkflowOptions<T>,
): UseApprovalWorkflow<T> {
  const { initialItem, canApprove = false, onChange, onApprove, onReject, onNotify } =
    options;

  const [item, setItem] = useState<ApprovalItem<T>>(initialItem);

  const submit = useCallback(
    async (next: T, submittedBy?: string): Promise<void> => {
      const updated: ApprovalItem<T> = {
        id: item.id,
        status: 'PENDIENTE',
        current: next,
        previous: item.current,
        submittedBy,
        // Nueva versión a revisión: se limpia la revisión anterior.
        reviewedBy: undefined,
        reviewedAt: undefined,
        reason: undefined,
      };
      setItem(updated);
      await onNotify?.(updated);
      await onChange?.(updated);
    },
    [item.id, item.current, onNotify, onChange],
  );

  const approve = useCallback(
    async (reviewer: string): Promise<void> => {
      if (!canApprove) {
        throw new Error('No tienes permiso para aprobar este item.');
      }
      if (!isReviewable(item.status)) {
        throw new Error('Solo se puede aprobar un item en estado PENDIENTE.');
      }
      const updated: ApprovalItem<T> = {
        id: item.id,
        status: 'APROBADO',
        current: item.current,
        previous: item.current,
        submittedBy: item.submittedBy,
        reviewedBy: reviewer,
        reviewedAt: new Date().toISOString(),
        reason: undefined,
      };
      setItem(updated);
      await onApprove?.(updated);
      await onChange?.(updated);
    },
    [canApprove, item, onApprove, onChange],
  );

  const reject = useCallback(
    async (reviewer: string, reason: string): Promise<void> => {
      if (!canApprove) {
        throw new Error('No tienes permiso para rechazar este item.');
      }
      if (!isReviewable(item.status)) {
        throw new Error('Solo se puede rechazar un item en estado PENDIENTE.');
      }
      const trimmed = reason.trim();
      if (trimmed.length === 0) {
        throw new Error('El motivo de rechazo es obligatorio.');
      }
      const updated: ApprovalItem<T> = {
        id: item.id,
        status: 'RECHAZADO',
        current: item.current,
        previous: item.current,
        submittedBy: item.submittedBy,
        reviewedBy: reviewer,
        reviewedAt: new Date().toISOString(),
        reason: trimmed,
      };
      setItem(updated);
      await onReject?.(updated);
      await onChange?.(updated);
    },
    [canApprove, item, onReject, onChange],
  );

  return useMemo(
    () => ({ item, canApprove, submit, approve, reject }),
    [item, canApprove, submit, approve, reject],
  );
}
