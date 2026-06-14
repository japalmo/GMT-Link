/**
 * Primitiva ApprovalWorkflow (§5) — re-exports públicos.
 *
 * Flujo de aprobación genérico (PENDIENTE → APROBADO / RECHAZADO) con
 * conservación de la versión anterior y gancho de notificación al aprobador.
 */
export type { ApprovalStatus, ApprovalItem } from './types';
export {
  useApprovalWorkflow,
  type UseApprovalWorkflow,
  type UseApprovalWorkflowOptions,
} from './use-approval-workflow';
export {
  ApprovalWorkflow,
  type ApprovalWorkflowProps,
  type ApprovalValueRenderer,
} from './approval-workflow';
