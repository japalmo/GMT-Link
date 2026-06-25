/**
 * Tipos públicos de la primitiva ApprovalWorkflow (§5).
 *
 * Flujo de estados PENDIENTE → APROBADO / RECHAZADO con conservación de la
 * versión anterior. Genérico sobre el payload `T` que se aprueba (un documento,
 * una ficha de perfil, una plantilla de checklist, un update de insumos, …).
 *
 * La primitiva NO decide permisos (§3.1 — mínimo privilegio): el consumidor le
 * pasa `canApprove` resuelto vía OpenFGA. Tampoco notifica: expone un gancho
 * `onNotify` para que el backend dispare la notificación real al aprobador.
 */

/** Estados de la máquina de aprobación. */
export type ApprovalStatus = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';

/**
 * Item bajo aprobación. `current` es la versión vigente (la que se evalúa o ya
 * quedó vigente); `previous` conserva la versión inmediatamente anterior tras
 * una transición (submit / approve / reject).
 *
 * @typeParam T - Forma del contenido versionado que se aprueba.
 */
export interface ApprovalItem<T> {
  /** Identificador estable del item (no cambia entre versiones). */
  readonly id: string;
  /** Estado actual de la máquina. */
  readonly status: ApprovalStatus;
  /** Versión vigente del contenido. */
  readonly current: T;
  /** Versión anterior conservada tras una transición. */
  readonly previous?: T;
  /** Identidad de quien envió la versión vigente a revisión. */
  readonly submittedBy?: string;
  /** Identidad de quien aprobó o rechazó por última vez. */
  readonly reviewedBy?: string;
  /** Marca temporal (ISO 8601) de la última revisión. */
  readonly reviewedAt?: string;
  /** Motivo del rechazo (solo presente cuando `status === 'RECHAZADO'`). */
  readonly reason?: string;
}
