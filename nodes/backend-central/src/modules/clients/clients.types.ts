/**
 * Vista de cliente con métricas agregadas para el listado del dashboard.
 */
export interface ClientView {
  id: string;
  code: string;
  name: string;
  rut: string | null;
  /** Total de proyectos del cliente. */
  projectsCount: number;
  /**
   * Proyectos "activos": sin faena, o cuya faena no está COMPLETADA y no tiene
   * fecha de fin (criterio de "ausencia de fecha fin", ver A0.3).
   */
  activeProjectsCount: number;
  /** Tareas en estado PENDIENTE en los proyectos del cliente. */
  pendingAlertsCount: number;
}
