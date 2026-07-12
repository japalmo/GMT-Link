/**
 * Tipos de la jerarquía de Proyectos (Demo A0): Cliente → Faena → Proyecto →
 * Trabajadores. Reexportan los contratos compartidos de
 * `@gmt-platform/contracts` para que los consumidores del front (api.ts, hooks,
 * páginas) importen desde `@/types/projects` sin duplicar definiciones (patrón
 * del repo, ver `@/types/operations`, `@/types/assets`).
 */
export type {
  // Vistas
  ClientView,
  FaenaView,
  ProjectWorkerAssignmentView,
  ProjectAdminOption,
  UserRef,
  // Enums
  ProjectType,
  FaenaStatus,
  ProjectWorkerStatus,
  ServiceFrequency,
  VariableType,
  // Inputs
  CreateClientInput,
  UpdateClientInput,
  CreateFaenaInput,
  CreateProjectInput,
  AssignWorkerInput,
  PhaseVariableSpecInput,
  PhaseDataSpecInput,
} from '@gmt-platform/contracts';
