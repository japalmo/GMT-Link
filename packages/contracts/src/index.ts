/**
 * @gmt-platform/contracts — tipos compartidos del monorepo.
 * Los tipos de dominio se agregan por etapa según el plan maestro (§4.2).
 */

/** Respuesta del endpoint GET /health de nodes/backend-central. Valida el wiring del workspace en 0.1. */
export interface HealthResponse {
  status: 'ok';
  service: 'gmt-link-api';
  timestamp: string;
}

/** Scopes de membresía (§4.2 — enum ScopeType). */
export type ScopeType = 'ORGANIZATION' | 'DEPARTMENT' | 'PROJECT' | 'SERVICE';

/**
 * Página de un listado con paginación keyset (cursor estable). `items` es la
 * página actual; `nextCursor` es la clave opaca para pedir la siguiente página
 * (null cuando no hay más). Genérico y reutilizable en cualquier listado
 * paginado del servidor (activos, usuarios, finanzas, …).
 */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Claves de rol válidas (semilla §6-0.2 / §4.3). Son los bundles asignables.
 * La fuente de verdad de autorización es OpenFGA; esta lista es el contrato
 * compartido back↔front para validar y pintar selects de roles.
 */
export const ROLE_KEYS = [
  // Roles funcionales/estructurales heredados (siguen sembrados en seed.ts).
  'org_admin',
  'department_admin',
  'project_creator',
  'operator',
  'qa',
  'finance',
  'viewer',
  'client_ito',
  // Roles de sistema Fase 1 (spec §2.3).
  'trabajador',
  'admin_contrato',
  'admin_finanzas',
  'analista_rh',
  'analista_finanzas',
  'asesor_hse',
  'gerencia_proyectos',
  'gerencia_rh',
  'gerencia_general',
  'admin_ti',
] as const;

/**
 * Clave de rol. Antes unión cerrada sobre `ROLE_KEYS`; con roles dinámicos
 * (§7 design doc RBAC) cualquier string es válido (incluye roles personalizados
 * `c_xxx`). La validación dura contra la tabla `Role` la hace el backend
 * (`UsersService.validateRoleKeys` / `RolesService`), no el tipo.
 */
export type RoleKey = string;

/** Estados de usuario (§4.2 — enum UserStatus). */
export type UserStatus = 'PENDING_FIRST_LOGIN' | 'ACTIVE' | 'SUSPENDED';

/**
 * A qué correo del usuario aplica una operación (espejo del enum Prisma
 * `EmailKind`): institucional o personal. Se usa para el cambio de correo
 * verificado y para el destino de notificaciones por email.
 */
export type EmailKind = 'INSTITUCIONAL' | 'PERSONAL';

/** Vista pública de un usuario provisionado (respuesta de creación, §1.1). */
export interface ProvisionedUser {
  id: string;
  email: string;
  username: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  firstName: string;
  lastName: string;
  status: UserStatus;
  roleKeys: RoleKey[];
}

/**
 * Perfil propio del usuario autenticado (§6-1.3 "Mis datos").
 * El `email` es la identidad Firebase → SOLO LECTURA. `roleKeys` viene de las
 * Membership ORGANIZATION del propio usuario. Los campos editables son
 * firstName/secondName/lastName/secondLastName/avatarUrl (ver UpdateProfileInput).
 */
export interface ProfileMe {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  /** Correo institucional (§4.1). null si el usuario solo tiene personal. */
  emailInstitucional: string | null;
  /** Correo personal (§4.1). null si el usuario solo tiene institucional. */
  emailPersonal: string | null;
  /** ¿El institucional está verificado por OTP? (timestamp != null en la BD). */
  emailInstitucionalVerified: boolean;
  /** ¿El personal está verificado por OTP? (timestamp != null en la BD). */
  emailPersonalVerified: boolean;
  /** Correo propuesto en un cambio pendiente de confirmar por OTP; null si no hay. */
  pendingEmail: string | null;
  /** A qué campo aplica el cambio pendiente; null si no hay cambio en curso. */
  pendingEmailKind: EmailKind | null;
  avatarUrl: string | null;
  status: UserStatus;
  isClientUser: boolean;
  roleKeys: RoleKey[];
}

/** Campos editables del perfil propio (§6-1.3). Todos opcionales; email NO editable. */
export interface UpdateProfileInput {
  firstName?: string;
  secondName?: string;
  lastName?: string;
  secondLastName?: string;
  avatarUrl?: string;
}

/** Respuesta de POST /profile/change-password. Incluye el JWT re-emitido de la
 * sesión actual (al cambiar la clave se sube tokenVersion y los tokens previos
 * quedan inválidos; el cliente debe guardar este token para no cerrar su sesión). */
export interface ChangePasswordResponse {
  ok: true;
  token: string;
}

/**
 * Respuesta genérica de acuse (endpoints de solicitud que NO revelan el código):
 * POST /profile/email/change-request y POST /profile/password/change-request.
 */
export interface OkResponse {
  ok: true;
}

/**
 * Body de POST /profile/email/change-request. Exige la contraseña actual
 * (reautenticación) y pide un OTP al `newEmail` para verificarlo antes de
 * aplicarlo al campo `kind`. El código NO se retorna: viaja solo por correo
 * (EmailService).
 */
export interface ChangeEmailRequestInput {
  currentPassword: string;
  newEmail: string;
  kind: EmailKind;
}

/** Body de POST /profile/email/change-confirm. Confirma el cambio con el OTP recibido. */
export interface ChangeEmailConfirmInput {
  code: string;
}

/**
 * Body de POST /profile/change-password (endurecido): exige la contraseña actual
 * y el OTP enviado por POST /profile/password/change-request, además de la nueva
 * contraseña (mínimo 8 caracteres).
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  code: string;
}

/**
 * Item del directorio (§6-1.6). Campos BÁSICOS visibles para cualquier usuario
 * autenticado. Sin datos internos (status/points): esos van en el detalle
 * extendido y solo si el solicitante tiene el permiso directory:view:extended.
 */
export interface DirectoryEntry {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  roleKeys: RoleKey[];
  isClientUser: boolean;
  companyName?: string | null;
}

/**
 * Detalle extendido del directorio (§6-1.6). Básicos + campos internos.
 * Solo se sirve a quien tiene directory:view:extended (organization#can_view_directory_extended).
 */
export interface DirectoryEntryExtended extends DirectoryEntry {
  status: UserStatus;
  points: number;
  secondName: string | null;
  secondLastName: string | null;
}

// ============ RBAC dinámico — contrato de scope (Módulo 4, ADR-0001) ============

/**
 * Filtro de fila que la fachada `PermissionService` resuelve por permiso y que el
 * backend aplica SERVER-SIDE (nunca confía en el body del cliente):
 *  - `none`     → GLOBAL: sin restricción de fila.
 *  - `own`      → OWN: WHERE createdById = userId.
 *  - `projects` → PROJECT: WHERE projectId IN (ids del usuario).
 */
export type ScopeFilter =
  | { kind: 'none' }
  | { kind: 'own' }
  | { kind: 'projects'; ids: string[] };

/** Decisión de autorización para un recurso individual. */
export interface PermissionDecision {
  effect: 'allow' | 'deny';
  filter: ScopeFilter;
}

/** Referencia mínima de un recurso para decidir un permiso de 1 instancia. */
export interface ResourceRef {
  projectId?: string;
  createdById?: string;
}

/** Alcance de un permiso dentro de un rol (espejo del enum Prisma `PermissionScope`). */
export type PermissionScopeValue = 'OWN' | 'PROJECT' | 'GLOBAL';

// ============ Roles dinámicos — matriz RBAC (design doc 2026-07-01) ============

/** Naturaleza de un permiso del catálogo (§8): resuelto en Postgres o en OpenFGA. */
export type PermissionKind = 'FUNCTIONAL' | 'STRUCTURAL';

/** Tipo de objeto FGA sobre el que se materializa un permiso STRUCTURAL componible. */
export type FgaObjectType = 'organization' | 'project';

/** Item del catálogo de permisos servido por `GET /permissions`. */
export interface PermissionCatalogItem {
  key: string;
  label: string;
  module: string;
  kind: PermissionKind;
  scopeable: boolean;
  fgaObjectType: FgaObjectType | null;
  composable: boolean;
}

/** Catálogo de permisos agrupado por módulo (orden: alfabético por `module`). */
export interface PermissionCatalogGroup {
  module: string;
  items: PermissionCatalogItem[];
}

/** Un grant dentro de un rol: permiso + alcance de resolución FUNCTIONAL. */
export interface RoleGrant {
  permissionKey: string;
  scope: PermissionScopeValue;
}

/** Detalle completo de un rol (sistema o personalizado). */
export interface RoleDetail {
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  allowedScopeTypes: ScopeType[];
  grants: RoleGrant[];
}

/** Body de `POST /roles`. */
export interface CreateRoleInput {
  label: string;
  description?: string;
  grants: RoleGrant[];
}

/** Body de `PATCH /roles/:key`. */
export interface UpdateRoleInput {
  label?: string;
  description?: string;
  grants?: RoleGrant[];
}

/** Body de `POST /users/:id/roles` (asignación por scope). */
export interface AssignRoleInput {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
}

/**
 * Membership de un usuario (rol + scope), A4. Lo consumen las respuestas de
 * asignación (`UserRolesResponse` extendida) y `UserListItem` — esos dos tipos
 * viven en el backend (`users.types.ts`) y en `nodes/web/src/lib/api.ts`; se
 * extienden con `memberships: UserMembership[]` en Fase 3 (backend) y Fase 5 (web).
 */
export interface UserMembership {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
}

/**
 * Respuesta de `POST /roles/:key/clone` (A7): el rol clonado + las claves de
 * permisos omitidos por NO ser componibles (así clonar roles del sistema
 * funciona y la UI puede avisar qué quedó afuera, spec §6.2/§13.4).
 */
export interface CloneRoleResponse {
  role: RoleDetail;
  omittedPermissionKeys: string[];
}

// ============ Proyectos: jerarquía Cliente → Faena → Proyecto (Demo A0) ============

/** Tipo de proyecto (espejo del enum Prisma `ProjectType`, plan demo A0.1). */
export type ProjectType = 'SPOT' | 'OBRAS_CIVILES' | 'RUTINARIO';

/** Estado de una faena (espejo del enum Prisma `FaenaStatus`, plan demo A0.1). */
export type FaenaStatus = 'PLANIFICADA' | 'EN_PROGRESO' | 'COMPLETADA';

/** Estado de la asignación de un trabajador a un proyecto (enum Prisma `ProjectWorkerStatus`). */
export type ProjectWorkerStatus = 'ACTIVO' | 'INACTIVO';

/** Frecuencia de un servicio RUTINARIO (espejo del enum Prisma `ServiceFrequency`). */
export type ServiceFrequency =
  | 'DIARIA'
  | 'SEMANAL'
  | 'QUINCENAL'
  | 'MENSUAL'
  | 'A_DEMANDA';

/**
 * Tipo de dato de una Variable de fase/servicio (espejo del enum Prisma
 * `VariableType`, ampliado en el plan demo A0.1). `SCALAR/FILE/LIST` son los
 * heredados; el resto son los tipos enriquecidos para el editor de datos
 * esperados por fase.
 */
export type VariableType =
  | 'SCALAR'
  | 'FILE'
  | 'LIST'
  | 'ENTERO'
  | 'DECIMAL'
  | 'BOOLEAN'
  | 'METROS'
  | 'M3'
  | 'TEXTO'
  | 'IMAGEN'
  | 'PLANO'
  | 'POLIGONO'
  | 'ORTOFOTO'
  | 'PDF'
  | 'GEODATA'
  | 'OTRO';

/** Referencia mínima de un usuario embebida en vistas (id + nombre + email). */
export interface UserRef {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Vista de un cliente para el catálogo `GET /clients` (Capa 1). Incluye las
 * métricas del carrusel de la card: total histórico de proyectos, activos y
 * alertas pendientes (tasks PENDIENTE en proyectos del cliente).
 */
export interface ClientView {
  id: string;
  code: string;
  name: string;
  rut: string | null;
  projectsCount: number;
  activeProjectsCount: number;
  pendingAlertsCount: number;
}

/**
 * Vista de una faena para el catálogo `GET /clients/:id/faenas` (Capa 2).
 * Expone las 3 métricas de la card al nivel raíz, en paridad con {@link ClientView}.
 */
export interface FaenaView {
  id: string;
  code: string;
  name: string;
  clientId: string;
  supervisorId: string | null;
  status: FaenaStatus;
  startDate: string | null;
  endDate: string | null;
  /** Coordenadas/dirección para el mapa de la faena (opcionales). */
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  projectsCount: number;
  activeProjectsCount: number;
  pendingAlertsCount: number;
}

/**
 * Vista de la asignación de un trabajador a un proyecto (Capa 4 / tab
 * Trabajadores). `user` se hidrata cuando el endpoint incluye el detalle.
 */
export interface ProjectWorkerAssignmentView {
  id: string;
  projectId: string;
  userId: string;
  roleKey: RoleKey;
  status: ProjectWorkerStatus;
  startDate: string | null;
  endDate: string | null;
  user?: UserRef;
}

// ============ Proyectos: inputs de creación/edición (Demo A0) ============

/** Body de `POST /clients` (A0.3). `code` ≤ 4 chars (codificación §7). */
export interface CreateClientInput {
  code: string;
  name: string;
  rut?: string;
}

/** Body de `PATCH /clients/:id` (A0.3). Todos opcionales. */
export interface UpdateClientInput {
  code?: string;
  name?: string;
  rut?: string;
}

/**
 * Body de `POST /clients/:id/faenas`. El `code` se autogenera server-side
 * (`${client.code}-${letra correlativa}`): el input solo trae `name` y, opcional,
 * la ubicación en el mapa. supervisor/estado/fechas se editan luego (no en la creación).
 */
export interface CreateFaenaInput {
  name: string;
  /** Ubicación en el mapa (opcional). lat -90..90 / lng -180..180. */
  latitude?: number;
  longitude?: number;
  address?: string;
}

/**
 * Body de `PATCH /faenas/:id`. Espejo de `UpdateFaenaDto` del backend: los
 * campos editables de una faena (supervisor/estado/fechas se fijan acá, no al
 * crear). Todos opcionales; el `code` NO es editable (se autogenera server-side).
 */
export interface UpdateFaenaInput {
  name?: string;
  supervisorId?: string;
  status?: FaenaStatus;
  /** ISO-8601. */
  startDate?: string;
  /** ISO-8601. */
  endDate?: string;
}

/**
 * Body de `POST /projects`. El `code` se autogenera server-side
 * (`${faena.code}-${n correlativo}`), por eso `faenaId` es OBLIGATORIO. El
 * departamento ya no se pide en la creación (jerarquía Cliente→Faena→Proyecto).
 */
export interface CreateProjectInput {
  name: string;
  clientId: string;
  faenaId: string;
  contractNumber?: string;
  projectType?: ProjectType;
  projectAdminId?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Body de `PATCH /projects/:id`. En este corte SOLO se editan `name` y
 * `description`; el cambio de faena queda fuera por el churn de clientId/code/FGA.
 * Todos opcionales.
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
}

/**
 * Opción del selector de administrador de proyecto (`GET /users/project-admins`).
 * Solo usuarios cuyo rol otorga el permiso `project:manage`. `roleKeys` son las
 * claves de rol del usuario que conceden ese permiso (para pintar el select).
 */
export interface ProjectAdminOption {
  id: string;
  fullName: string;
  roleKeys: RoleKey[];
}

/** Body de `POST /projects/:id/assignments` (A0.4, gate `project:team:manage`). */
export interface AssignWorkerInput {
  userId: string;
  roleKey: RoleKey;
  status?: ProjectWorkerStatus;
  startDate?: string;
  endDate?: string;
}

/** Una variable dentro del spec de datos esperados de una fase (A0.4). */
export interface PhaseVariableSpecInput {
  code: string;
  name: string;
  type: VariableType;
  unit?: string;
  description?: string;
  required?: boolean;
}

/** Body de `PUT /metrics/phases/:id/dataspec` (A0.4): las variables tipadas de la fase. */
export interface PhaseDataSpecInput {
  variables: PhaseVariableSpecInput[];
}

// ============ Activos: tipos, estados, subtipos y vistas (GAP5) ============

/** Tipo de activo (espejo del enum Prisma `AssetType`). */
export type AssetType = 'EQUIPO' | 'VEHICULO' | 'MAQUINARIA';

/** Estado operativo de un activo (espejo del enum Prisma `AssetStatus`). */
export type AssetStatus =
  | 'DISPONIBLE'
  | 'EN_USO'
  | 'MANTENIMIENTO'
  | 'BAJA'
  | 'DEFECTUOSO'
  | 'NO_DISPONIBLE';

/** Subtipo de vehículo (espejo del enum Prisma `VehicleSubtype`). */
export type VehicleSubtype = 'PICKUP' | 'FURGON' | 'AUTO' | 'AUTOBUS' | 'CAMION';

/** Tipo de identificador de un activo (espejo del enum Prisma `AssetIdentifierType`). */
export type AssetIdentifierType = 'PATENTE' | 'NUMERO_SERIE';

/**
 * Vista completa de un activo (respuesta de listados, detalle y mutaciones).
 * Incluye `publicToken`: token opaco no enumerable para la ficha pública / QR (GAP3).
 */
export interface AssetView {
  id: string;
  code: string;
  /** Token opaco no enumerable para la ficha pública / QR (GAP3). */
  publicToken: string;
  type: AssetType;
  name: string;
  description: string | null;
  manufacturer: string | null;
  identifier: string | null;
  identifierType: AssetIdentifierType | null;
  vehicleSubtype: VehicleSubtype | null;
  status: AssetStatus;
  projectId: string | null;
  assignedToId: string | null;
  inUseById: string | null;
  inUseSince: string | null; // ISO-8601
  metadata: Record<string, unknown> | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  project?: { id: string; name: string } | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  inUseBy?: { id: string; firstName: string; lastName: string } | null;
  /**
   * ¿El usuario actual puede gestionar este activo (accesorios, asignación,
   * checklist)? Es el mismo permiso que exigen las mutaciones: `can_manage_assets`
   * sobre el proyecto, o `admin` de la organización para activos globales. Solo lo
   * puebla el detalle (`GET /assets/:id`); en listados queda `undefined`.
   */
  canManageAssets?: boolean;
}

/** Ficha pública de un activo (respuesta del endpoint público por token, GAP3). */
export interface AssetPublicView {
  code: string;
  type: AssetType;
  name: string;
  description: string | null;
  manufacturer: string | null;
  vehicleSubtype: VehicleSubtype | null;
  status: AssetStatus;
  project?: { name: string } | null;
}
