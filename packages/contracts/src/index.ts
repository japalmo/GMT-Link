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

// ============ Motor de tablas unificado (server-side, offset) ============

/** Dirección de orden de una columna. */
export type SortDir = 'asc' | 'desc';

/**
 * Request genérico de una tabla server-side (paginación por offset). Todo el
 * filtrado, la búsqueda y el orden se resuelven en el servidor sobre el dataset
 * completo (no solo la página cargada). Lo consume el hook `useDataTable` del
 * front y lo procesa el helper `paginateTable` del backend.
 */
export interface TableRequest {
  /** Página 1-based. */
  page: number;
  /** Filas por página. El backend la acota a un máximo. */
  pageSize: number;
  /** Búsqueda de texto libre (el endpoint define en qué columnas busca). */
  search?: string;
  /** Clave de columna por la que ordenar (el endpoint define las permitidas). */
  sortBy?: string;
  /** Dirección del orden. */
  sortDir?: SortDir;
  /** Filtros estructurados por columna (valor único; multivalor como CSV). */
  filters?: Record<string, string>;
}

/** Página de resultados de una tabla server-side (offset). */
export interface TablePage<T> {
  items: T[];
  /** Total de filas que matchean el filtro/búsqueda (para "de Z" y el nº de páginas). */
  total: number;
  page: number;
  pageSize: number;
}

// ============ Administración de usuarios (detalle: editar / borrar / reenviar clave) ============

/**
 * Campos editables por un administrador en el detalle de un usuario
 * (`PATCH /users/:id`). Todos opcionales: se aplican solo los presentes. El
 * `email` legacy lo re-deriva el backend (= institucional ?? personal). No
 * incluye clave, estado ni roles (se gestionan por sus propios flujos).
 */
export interface UpdateUserAdminInput {
  firstName?: string;
  secondName?: string | null;
  lastName?: string;
  secondLastName?: string | null;
  emailInstitucional?: string | null;
  emailPersonal?: string | null;
  username?: string;
  cargo?: string | null;
  isClientUser?: boolean;
}

/**
 * Vista previa del correo de reenvío de clave. La clave provisoria NUNCA viaja
 * al front: se regenera y se inyecta en el servidor al enviar. El admin ve el
 * asunto y el mensaje (editables) y una representación enmascarada de la clave.
 */
export interface ResendInvitePreview {
  /** Destinatario (email institucional o personal). Vacío si el usuario no tiene correo. */
  to: string;
  /** ¿Se puede enviar el correo desde el servidor? (hay proveedor real + destinatario). */
  canEmail: boolean;
  username: string;
  nombre: string;
  /** Asunto por defecto (editable). */
  subject: string;
  /** Mensaje/intro por defecto (editable). La clave se inyecta aparte, server-side. */
  message: string;
}

/** Cuerpo de `POST /users/:id/resend-invite`. */
export interface ResendInviteInput {
  /** Si `true` y hay correo, el servidor envía el correo con la clave inyectada. */
  sendEmail: boolean;
  /** Asunto editado por el admin (solo se usa si `sendEmail`). */
  subject?: string;
  /** Mensaje/intro editado por el admin (solo se usa si `sendEmail`). */
  message?: string;
}

/** Resultado de reenviar la clave (`POST /users/:id/resend-invite`). */
export interface ResendInviteResult {
  /** `true` si el servidor envió el correo (clave inyectada allí, nunca retornada). */
  sent: boolean;
  /** Destinatario al que se envió, o `null` en el camino manual. */
  to: string | null;
  /** Clave provisoria — SOLO en el camino manual (`sent=false`); `null` si se envió por correo. */
  provisionalPassword: string | null;
}

// ============ Horario / turnos del trabajador (detalle de usuario) ============

/**
 * Patrón de turno de un trabajador. Los preset cíclicos definen días de faena y
 * descanso; `PERSONALIZADO` deja que el admin fije esos días a mano;
 * `ADMINISTRATIVO` no rota: trabaja los días de la semana definidos en
 * `weeklyHours` (lunes a viernes si aún no se define).
 */
export type ShiftPattern =
  | 'ADMINISTRATIVO'
  | 'SIETE_POR_SIETE'
  | 'CUATRO_POR_TRES'
  | 'CATORCE_POR_CATORCE'
  | 'PERSONALIZADO';

/** Turno diurno o nocturno. */
export type DayNight = 'DIA' | 'NOCHE';

/** Días de faena/descanso por preset cíclico. `null` = no aplica (administrativo/personalizado). */
export const SHIFT_PATTERN_CYCLE: Record<ShiftPattern, { workDays: number; restDays: number } | null> = {
  ADMINISTRATIVO: null,
  SIETE_POR_SIETE: { workDays: 7, restDays: 7 },
  CUATRO_POR_TRES: { workDays: 4, restDays: 3 },
  CATORCE_POR_CATORCE: { workDays: 14, restDays: 14 },
  PERSONALIZADO: null,
};

/**
 * Horario de UN día de la semana dentro del horario semanal (patrón
 * `ADMINISTRATIVO`). Solo los días trabajados aparecen en el arreglo: un día
 * ausente es día de descanso.
 */
export interface WeeklyHoursEntry {
  /** Día de la semana, convención ISO-8601: 1 = lunes .. 7 = domingo. */
  weekday: number;
  /** Hora de inicio de la jornada de ese día, "HH:mm" 24h. */
  start: string;
  /**
   * Hora de término de la jornada de ese día, "HH:mm" 24h. Posterior a `start` en
   * turno DÍA; en turno NOCHE puede ser anterior (la jornada cruza la medianoche,
   * p. ej. 22:00 a 06:00), nunca igual a `start`.
   */
  end: string;
}

/**
 * Jornada/turnos de un trabajador (`GET /users/:id/schedule`). `null` en el
 * endpoint cuando el trabajador aún no tiene jornada configurada.
 */
export interface WorkScheduleView {
  shiftPattern: ShiftPattern;
  /** Días de faena del ciclo (solo patrones cíclicos); null en administrativo. */
  workDays: number | null;
  /** Días de descanso del ciclo; null en administrativo. */
  restDays: number | null;
  /** Día 1 del ciclo (primer día en faena), ISO-8601 date-only; null si sin definir. */
  cycleStart: string | null;
  dayNight: DayNight;
  /** Jornada diaria "HH:mm"; null si sin definir. En cíclicos es la jornada en faena. */
  startTime: string | null;
  /** Jornada diaria "HH:mm"; null si sin definir. En cíclicos es la jornada en faena. */
  endTime: string | null;
  /**
   * Horario semanal por día (solo `ADMINISTRATIVO`): un elemento por día
   * trabajado, ordenado por `weekday`. `null` en los patrones cíclicos (en faena
   * todos los días usan `startTime`/`endTime`) y en filas ADMINISTRATIVO
   * anteriores a esta columna, que se interpretan como lunes a viernes con
   * `startTime`/`endTime` legacy.
   */
  weeklyHours: WeeklyHoursEntry[] | null;
  notes: string | null;
  /** ISO-8601. */
  updatedAt: string;
}

/**
 * Cuerpo de `PUT /users/:id/schedule` (upsert completo). `shiftPattern` y
 * `dayNight` son obligatorios. Los patrones cíclicos (7x7, 4x3, 14x14 y
 * `PERSONALIZADO`) exigen `cycleStart`; además `PERSONALIZADO` exige
 * `workDays`/`restDays` (>=1), mientras los preset los derivan de
 * `SHIFT_PATTERN_CYCLE`. `ADMINISTRATIVO` ignora los días de ciclo y la fecha de
 * inicio, y define su horario por día con `weeklyHours` (si no viene, el server
 * lo deriva de `startTime`/`endTime` como lunes a viernes). Los cíclicos ignoran
 * `weeklyHours` y usan `startTime`/`endTime` como jornada en faena, en "HH:mm".
 */
export interface UpsertWorkScheduleInput {
  shiftPattern: ShiftPattern;
  workDays?: number | null;
  restDays?: number | null;
  cycleStart?: string | null;
  dayNight: DayNight;
  startTime?: string | null;
  endTime?: string | null;
  /** Horario semanal por día (solo `ADMINISTRATIVO`): al menos 1 día, weekday 1..7 únicos. */
  weeklyHours?: WeeklyHoursEntry[] | null;
  notes?: string | null;
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
  // Rol de sistema Logística (módulo Inventario).
  'logistica',
  // Rol de sistema Conductor (flota de vehículos): reporta uso y ejecuta checklist.
  'conductor',
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
  cargo: string | null;
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
  /** Cargo/puesto declarado (texto libre, editable por el propio usuario). */
  cargo: string | null;
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
  /** Cargo/puesto; `null`/'' lo limpia. */
  cargo?: string | null;
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
  /** Cargo/puesto declarado; el directorio muestra el cargo, no los roles. */
  cargo: string | null;
  /**
   * Roles org del usuario. El directorio NO los muestra (muestra el cargo), pero
   * otros flujos los consumen (p.ej. filtrar autorizadores de horas extra).
   */
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

// ============ Tipos de servicio + procedimientos (Tanda 4) ============

/**
 * Un procedimiento dentro de un tipo de servicio: un paso de trabajo con
 * instrucciones. Por ahora solo texto; a futuro cargará información y definirá
 * flujos de trabajo (fase en hold).
 */
export interface Procedimiento {
  /** Id estable del paso (cuid/uuid del cliente). */
  id: string;
  nombre: string;
  /** Instrucciones del procedimiento; opcional. */
  instrucciones?: string | null;
}

/**
 * Tipo de servicio del catálogo org (`GET /service-types`). Reutilizable entre
 * proyectos. `serviceCount` indica cuántos servicios lo usan (para avisar antes de
 * desactivar/borrar).
 */
export interface ServiceTypeView {
  id: string;
  /** Código corto (2-4 chars, MAYÚSCULAS): semilla del código de documento §7. */
  code: string;
  name: string;
  description: string | null;
  requiresClientSignature: boolean;
  procedures: Procedimiento[];
  isActive: boolean;
  serviceCount: number;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/** Cuerpo de `POST /service-types`. */
export interface CreateServiceTypeInput {
  code: string;
  name: string;
  description?: string | null;
  requiresClientSignature?: boolean;
  procedures?: Procedimiento[];
}

/** Cuerpo de `PATCH /service-types/:id` (parcial; solo se aplican los presentes). */
export interface UpdateServiceTypeInput {
  code?: string;
  name?: string;
  description?: string | null;
  requiresClientSignature?: boolean;
  procedures?: Procedimiento[];
  isActive?: boolean;
}

/**
 * Cuerpo de `POST /projects/:id/services` (Tanda 4): el servicio se crea eligiendo
 * un tipo del catálogo + un nombre opcional. El código corto (§7) y la config de
 * firma se derivan del tipo en el servidor. `name` por defecto = nombre del tipo.
 */
export interface CreateServiceByTypeInput {
  serviceTypeId: string;
  name?: string;
  frequency?: ServiceFrequency | null;
}

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
  | 'EN_PREPARACION' // reservado: alguien reportó uso y está llenando el checklist inicial
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

/** Estado de un ciclo de uso (espejo del enum Prisma `UsageCycleStatus`). */
export type UsageCycleStatus = 'EN_PREPARACION' | 'EN_CURSO' | 'CERRADO' | 'CANCELADO';

/** Forma de cierre de un ciclo de uso (espejo del enum Prisma `UsageEndKind`). */
export type UsageEndKind = 'GPS' | 'ESTACIONAMIENTO' | 'TRASPASO';

/** Persona mínima referenciada en un ciclo de uso. */
export interface UsageCyclePerson {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * Vista de un ciclo de uso de un activo (reportar uso -> checklist -> en uso ->
 * terminar uso). Fechas en ISO-8601. Las fotos y los campos de cierre son opcionales.
 */
export interface UsageCycleView {
  id: string;
  assetId: string;
  userId: string;
  /** Usuario actual (quién reportó / tiene el uso). */
  user: UsageCyclePerson | null;
  status: UsageCycleStatus;
  /** Cuando reportó uso. */
  startedAt: string;
  /** Cuando pasó a EN_CURSO (checklist firmado / inmediato sin plantilla). */
  confirmedAt: string | null;
  /** Cuando terminó el uso. */
  endedAt: string | null;
  /** Checklist inicial ligado al ciclo (null si el activo no tiene plantilla). */
  checklistSubmissionId: string | null;
  /** Foto opcional al recoger. */
  startPhotoUrl: string | null;
  /** Foto opcional al dejar. */
  endPhotoUrl: string | null;
  endKind: UsageEndKind | null;
  /** Solo endKind = GPS. */
  endLatitude: number | null;
  endLongitude: number | null;
  /** Estacionamiento (texto libre) o nota de cierre. */
  endText: string | null;
  handoffToUserId: string | null;
  /** Usuario al que se traspasó (solo endKind = TRASPASO). */
  handoffTo: UsageCyclePerson | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Cuerpo de "terminar uso" (`POST /assets/:id/usage-cycles/:cycleId/end`). Según
 * `endKind`: GPS usa `latitude`/`longitude`; ESTACIONAMIENTO usa `text`; TRASPASO usa
 * `handoffToUserId` (ese usuario hará su propio checklist). La foto final va aparte
 * (multipart) y es opcional.
 */
export interface EndUsageCycleInput {
  endKind: UsageEndKind;
  latitude?: number;
  longitude?: number;
  text?: string;
  handoffToUserId?: string;
}

/**
 * Edición de los campos DESCRIPTIVOS de un activo (`PATCH /assets/:id`, Tanda 5.2).
 * Parcial: solo se aplican los presentes. NO incluye type, projectId, assignedToId
 * ni status (esos siguen con sus flujos dedicados).
 */
export interface UpdateAssetInput {
  name?: string;
  description?: string | null;
  manufacturer?: string | null;
  identifier?: string | null;
  identifierType?: AssetIdentifierType | null;
  vehicleSubtype?: VehicleSubtype | null;
  metadata?: Record<string, unknown>;
}

// ============ Checklist tipado de activos (Tanda 5) ============

/**
 * Tipos de campo de un ítem de checklist. Fuente única (antes duplicado en
 * web/backend con el union viejo). Legacy al leer: YES_NO→BOOLEAN, NUMBER→ENTERO,
 * TEXT→TEXTO (los históricos NO se migran; se normalizan al parsear).
 */
export type ChecklistItemType = 'BOOLEAN' | 'ESTADO' | 'ENTERO' | 'FECHA' | 'TEXTO' | 'SVG';

/** Una parte nombrada (`<g>`) de un diagrama SVG interactivo (p. ej. carrocería). */
export interface ChecklistSvgPart {
  /** Id del elemento `<g>` en el SVG. */
  id: string;
  /** Nombre legible de la parte (se muestra al pasar el cursor y en el comentario). */
  name: string;
}

/**
 * Configuración por ítem. `options`/`failOptions` aplican a ESTADO (opciones
 * configurables por campo, p.ej. Bueno/Regular/Malo con Malo = falla);
 * `isOdometer`/`min`/`max` a ENTERO; `requireObs`/`obsItemId` vinculan un ítem
 * TEXTO companion (observación exigida cuando el estado cae en falla). Para SVG,
 * `svg` es el marcado del diagrama y `parts` las partes nombradas (`<g>`) que el
 * inspector puede tocar para dejar un comentario.
 */
export interface ChecklistItemConfig {
  options?: string[];
  failOptions?: string[];
  requireObs?: boolean;
  obsItemId?: string;
  isOdometer?: boolean;
  min?: number;
  max?: number;
  /** SVG: marcado del diagrama interactivo. */
  svg?: string;
  /** SVG: partes nombradas (`<g>`) que se pueden comentar. */
  parts?: ChecklistSvgPart[];
}

/** Definición tipada de un ítem de la plantilla de checklist. */
export interface ChecklistTemplateItem {
  id: string;
  label: string;
  type: ChecklistItemType;
  required: boolean;
  config?: ChecklistItemConfig;
  /** Id de la sección (página) a la que pertenece el ítem; ausente = sección general. */
  section?: string;
}

/**
 * Sección (página) de una plantilla de checklist: agrupa ítems bajo un título y una
 * descripción. El formulario se renderiza como una página por sección, en el orden
 * del arreglo. Los ítems referencian su sección por `ChecklistTemplateItem.section`.
 */
export interface ChecklistSection {
  id: string;
  title: string;
  description?: string;
}

/** Respuesta a un ítem en una ejecución de checklist. `comment` = observación companion. */
export interface ChecklistAnswer {
  itemId: string;
  label: string;
  value: string | number | boolean | null;
  comment?: string;
}

// ============ Inventario (catálogo de artículos + solicitudes de insumos) ============

/** Estado de una solicitud de insumos (espejo del enum Prisma `SupplyRequestStatus`). */
export type SupplyRequestStatus = 'PENDIENTE' | 'ENTREGADA' | 'RECHAZADA';

/**
 * Fila del catálogo de Inventario (`GET /inventory/items/table`): el artículo con
 * su detalle descriptivo + stock total (suma de todas las bodegas) + cantidad de
 * proveedores vinculados. `category` hace de "tipo" en la UI.
 */
export interface InventoryItemView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  model: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Suma del stock del artículo en todas las bodegas. */
  totalStock: number;
  /** Cantidad de proveedores vinculados al artículo. */
  providerCount: number;
}

/** Stock de un artículo en una bodega (detalle de Inventario). */
export interface InventoryItemStockView {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
}

/** Vínculo artículo-proveedor: precio referencial (CLP) y URL opcional del producto. */
export interface SupplyProviderLinkView {
  id: string;
  providerId: string;
  providerName: string;
  /** CLP sin decimales; null si no se registra precio. */
  price: number | null;
  /** URL del producto (para monitoreo futuro de precios con IA). */
  url: string | null;
}

/** Body de `POST /inventory/items/:id/providers` (vincular proveedor a un artículo). */
export interface SupplyProviderLinkInput {
  providerId: string;
  /** CLP sin decimales. */
  price?: number;
  url?: string;
}

/** Detalle de un artículo (`GET /inventory/items/:id`): stocks por bodega + proveedores. */
export interface InventoryItemDetail extends InventoryItemView {
  stocks: InventoryItemStockView[];
  providers: SupplyProviderLinkView[];
}

/**
 * Fila del import masivo de Inventario (`POST /inventory/items/import`). Crear un
 * artículo NO implica stock; `stocks` permite carga inicial opcional en hasta 4
 * bodegas, resueltas POR CÓDIGO de bodega.
 */
export interface InventoryImportItemInput {
  code: string;
  name: string;
  brand?: string;
  category?: string;
  color?: string;
  size?: string;
  model?: string;
  unit?: string;
  description?: string;
  /** Stock inicial opcional: máximo 4 bodegas, referidas por su código. */
  stocks?: Array<{ warehouseCode: string; quantity: number }>;
}

/**
 * Resultado del import masivo: filas creadas y actualizadas, más los errores por
 * fila (una fila con error no aborta el lote).
 */
export interface InventoryImportResult {
  created: number;
  updated: number;
  errors: Array<{ code: string; message: string }>;
}

/** Ítem de una solicitud de insumos, hidratado con el nombre del artículo. */
export interface SupplyRequestItemView {
  id: string;
  supplyId: string;
  supplyCode: string;
  supplyName: string;
  unit: string;
  quantity: number;
}

/** Solicitud de insumos con solicitante e ítems (tablas de gestión y "mis solicitudes"). */
export interface SupplyRequestView {
  id: string;
  userId: string;
  requester: { firstName: string; lastName: string } | null;
  status: SupplyRequestStatus;
  note: string | null;
  rejectionReason: string | null;
  decidedById: string | null;
  /** ISO-8601; null mientras esté pendiente. */
  decidedAt: string | null;
  items: SupplyRequestItemView[];
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/** Una entrega de artículo a un trabajador ("mis artículos asignados"). */
export interface SupplyAssignmentView {
  id: string;
  supplyId: string;
  supplyCode: string;
  supplyName: string;
  unit: string;
  quantity: number;
  warehouseId: string | null;
  /** Quién entregó; null si el usuario ya no existe. */
  deliveredBy: { firstName: string; lastName: string } | null;
  /**
   * Trabajador que RECIBIÓ la entrega. Solo lo hidrata el historial completo
   * (`GET /inventory/assignments/table`); en "mis artículos" queda `undefined`
   * (el dueño ya se conoce).
   */
  worker?: { firstName: string; lastName: string } | null;
  /** Traza suave hacia la solicitud origen; null en entregas directas. */
  requestId: string | null;
  note: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/**
 * Ítem del catálogo LIVIANO (`GET /inventory/me/catalog`) para que un trabajador
 * arme su solicitud de insumos: forma mínima, sin stock, proveedores ni precios.
 */
export interface InventoryCatalogItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  /** "Tipo" del artículo en la UI; null si no está clasificado. */
  category: string | null;
}

/** Body de `POST /inventory/me/requests` (crear solicitud de insumos propia). */
export interface CreateSupplyRequestInput {
  note?: string;
  /** Mínimo 1 ítem; cada cantidad debe ser mayor a cero. */
  items: Array<{ supplyId: string; quantity: number }>;
}
