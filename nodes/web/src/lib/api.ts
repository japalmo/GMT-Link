import { getToken, setToken } from '@/lib/auth-token';
import type { AuthedUser } from '@/types/auth';
import type {
  CvCertificationInput,
  CvCertificationView,
  CvEducationInput,
  CvEducationView,
  CvExperienceInput,
  CvExperienceView,
  CvView,
} from '@/types/cv';
import type {
  DocumentFilters,
  PersonalDocumentView,
  UploadDocumentFields,
} from '@/types/documents';
import type { DashboardLayoutItem, DashboardView } from '@/types/dashboard';
import type {
  CreateOvertimeInput,
  CreateReimbursementInput,
  FinanceStatus,
  OvertimeView,
  ReimbursementView,
  UpdateOvertimeInput,
} from '@/types/finance';
import type { NotificationView } from '@/types/notifications';
import type {
  PermissionRequestAdminView,
  PermissionRequestView,
  UpdateSettingsInput,
  UserSettings,
} from '@/types/settings';
import type {
  AssignRoleInput,
  CloneRoleResponse,
  CreateRoleInput,
  DirectoryEntry,
  DirectoryEntryExtended,
  EmailKind,
  Paginated,
  PermissionCatalogGroup,
  ProfileMe,
  ResendInviteInput,
  ResendInvitePreview,
  ResendInviteResult,
  RoleDetail,
  RoleKey,
  TablePage,
  TableRequest,
  UpdateProfileInput,
  UpdateProjectInput,
  UpdateRoleInput,
  UpdateUserAdminInput,
  UpsertWorkScheduleInput,
  UserMembership,
  UserStatus,
  WorkScheduleView,
} from '@gmt-platform/contracts';

// Re-export para consumidores del front (enmienda A15: los tipos viven en
// @gmt-platform/contracts; api.ts solo los re-exporta para no duplicar imports).
export type {
  AssignRoleInput,
  CloneRoleResponse,
  ResendInviteInput,
  ResendInvitePreview,
  ResendInviteResult,
  TablePage,
  TableRequest,
  UpdateUserAdminInput,
  UpsertWorkScheduleInput,
  UserMembership,
  WorkScheduleView,
} from '@gmt-platform/contracts';
import type {
  ProjectView,
  ServiceView,
  TaskView,
  ProjectDocumentView,
  TaskStatus,
  TaskTimeLogView,
} from '@/types/operations';
import type {
  ClientView,
  CreateClientInput,
  UpdateClientInput,
  FaenaView,
  CreateFaenaInput,
  CreateProjectInput,
  ProjectAdminOption,
  ProjectWorkerAssignmentView,
  AssignWorkerInput,
  PhaseDataSpecInput,
  ServiceFrequency,
  UserRef,
} from '@/types/projects';
import type {
  ServiceTypeView,
  CreateServiceTypeInput,
  UpdateServiceTypeInput,
  CreateServiceByTypeInput,
} from '@gmt-platform/contracts';
import type {
  AssetView,
  AssetPublicView,
  UpdateAssetInput,
  AssetDocumentView,
  AssetHistoryEntryView,
  AssetType,
  AssetStatus,
  CreateAssetInput,
  ReviewAssetDocInput,
  AssetAccessoryView,
  ChecklistTemplateView,
  ChecklistSubmissionView,
  CreateAccessoryInput,
  UpdateAccessoryInput,
  UpdateChecklistTemplateInput,
  ReviewChecklistTemplateInput,
  SubmitChecklistInput,
} from '@/types/assets';

/** Base de la API (NestJS). Cae a localhost si la var no está definida. */
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/** Error de red/HTTP de la API, con el status para que la UI decida el mensaje. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Normaliza un error desconocido a un mensaje legible para la UI. Reconoce
 * `ApiError` (usa su `message`), `Error` genérico (si trae mensaje) y cae al
 * `fallback` en cualquier otro caso. Reemplaza los `toMessage` locales
 * duplicados en los diálogos de rechazo (finanzas / recursos).
 */
export function errorToMessage(
  error: unknown,
  fallback = 'Ocurrió un error',
): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Forma del cuerpo de error que devuelve NestJS (best-effort). */
interface NestErrorBody {
  message?: string | string[];
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as NestErrorBody;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}

/**
 * `fetch` tipado contra la API. Adjunta nuestro JWT de sesión (localStorage) en
 * `Authorization: Bearer …` cuando hay sesión. Lanza `ApiError` en respuestas
 * no-2xx con el mensaje más útil disponible.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // respuesta sin cuerpo JSON; usamos el fallback
    }
    throw new ApiError(
      extractMessage(body, `Error ${res.status} al llamar a la API.`),
      res.status,
    );
  }

  if (res.status === 204) return undefined as T;
  // Respuestas 2xx sin cuerpo (p. ej. el 201 `void` de revoke-sessions): no hay
  // JSON que parsear y `res.json()` lanzaría. En ese caso resolvemos `undefined`.
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as T;
  }
}

/**
 * `fetch` tipado para subidas multipart (archivos). A diferencia de
 * {@link request}, **NO** fija `Content-Type`: el navegador lo establece con el
 * `boundary` correcto a partir del `FormData`. Adjunta nuestro JWT de sesión
 * igual que `request` y comparte el manejo de errores (`ApiError`).
 */
async function uploadRequest<T>(
  path: string,
  formData: FormData,
  method = 'POST',
): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, body: formData, headers });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // respuesta sin cuerpo JSON; usamos el fallback
    }
    throw new ApiError(
      extractMessage(body, `Error ${res.status} al subir el archivo.`),
      res.status,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** `GET /auth/me` — usuario autenticado (Postgres). 401 si no hay sesión. */
export async function getMe(): Promise<AuthedUser> {
  const me = await request<AuthedUser>('/auth/me');
  // Defensa: un backend previo a la Fase 4 (RBAC) podría no enviar el campo.
  // Normalizamos a `false` (fail-closed) para que el tipo `boolean` no mienta.
  // `permissions` se normaliza a `[]` (fail-closed) por el mismo motivo.
  return {
    ...me,
    canManageRoles: me.canManageRoles ?? false,
    permissions: me.permissions ?? [],
  };
}

/** `POST /auth/login` — valida credenciales (username) y devuelve nuestro JWT. */
export function login(username: string, password: string): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/**
 * `POST /auth/first-login/complete` — fija la contraseña y activa la cuenta.
 * Exige la contraseña provisoria/actual (`currentPassword`): el backend la
 * re-verifica antes de aceptar el cambio (un token pendiente no basta por sí solo).
 * No devuelve datos de interés para la UI más allá del éxito.
 */
export async function completeFirstLogin(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<{ status: string }>('/auth/first-login/complete', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/* -------------------------------------------------------------------------- */
/* Usuarios (§6-1.1) — administración / provisión                              */
/* -------------------------------------------------------------------------- */

/** DTO para crear un usuario (contrato con `POST /users`). */
export interface CreateUserDto {
  firstName: string;
  secondName?: string;
  lastName: string;
  secondLastName?: string;
  username: string;
  emailInstitucional?: string;
  emailPersonal?: string;
  cargo?: string;
  roleKeys: RoleKey[];
  isClientUser?: boolean;
}

/** Fila del directorio de usuarios (`GET /users`). */
export interface UserListItem {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  username: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  cargo: string | null;
  status: UserStatus;
  /** ISO del primer ingreso completado; `null` = invitación aún no usada. */
  firstLoginAt: string | null;
  isClientUser: boolean;
  roleKeys: RoleKey[];
  /** Membresías (rol + alcance) del usuario — chips por membership (H13). */
  memberships: UserMembership[];
  createdAt: string;
}

/** Respuesta de creación de un usuario: incluye la clave provisoria (única vez). */
export interface CreateUserResponse {
  user: {
    id: string;
    email: string;
    username: string;
    emailInstitucional: string | null;
    emailPersonal: string | null;
    firstName: string;
    lastName: string;
    status: UserStatus;
    roleKeys: RoleKey[];
  };
  provisionalPassword: string;
}

/** Resultado por fila importada con éxito (incluye su clave provisoria). */
export interface ImportedUser {
  id: string;
  email: string;
  username: string;
  provisionalPassword: string;
}

/** Error por fila en la importación (no aborta el resto del lote). */
export interface ImportUserError {
  index: number;
  email: string;
  message: string;
}

/** Respuesta de `POST /users/import`: creados + errores por fila. */
export interface ImportUsersResponse {
  created: ImportedUser[];
  errors: ImportUserError[];
}

/** Respuesta de asignar/quitar un rol: id, roleKeys y memberships resultantes (A4). */
export interface UserRolesResponse {
  id: string;
  roleKeys: RoleKey[];
  memberships: UserMembership[];
}

/**
 * `GET /users` — página del directorio de usuarios con paginación keyset
 * (server-side). Devuelve `{ items, nextCursor }`: para la siguiente página se
 * reenvía `nextCursor` como `cursor`. `search` filtra server-side por nombre /
 * apellido / email / username. `limit` default 30, máx. 100.
 */
export function listUsers(
  params: { search?: string; limit?: number; cursor?: string } = {},
): Promise<Paginated<UserListItem>> {
  const query = new URLSearchParams();
  if (params.search && params.search.trim().length > 0) query.append('search', params.search.trim());
  if (params.limit !== undefined) query.append('limit', String(params.limit));
  if (params.cursor) query.append('cursor', params.cursor);
  const qs = query.toString();
  return request<Paginated<UserListItem>>(`/users${qs ? `?${qs}` : ''}`);
}

/**
 * `GET /users/table` — MOTOR de tablas server-side (offset). Búsqueda, filtro y
 * orden se resuelven en el servidor sobre el dataset COMPLETO; devuelve una página
 * numerada + total. Lo consume la tabla del directorio (`useDataTable`). Los
 * filtros viajan como `filters[clave]=valor`.
 */
export function fetchUsersTable(req: TableRequest): Promise<TablePage<UserListItem>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.search && req.search.trim().length > 0) query.set('search', req.search.trim());
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  if (req.filters) {
    for (const [key, value] of Object.entries(req.filters)) {
      if (value !== undefined && value !== '') query.set(`filters[${key}]`, value);
    }
  }
  return request<TablePage<UserListItem>>(`/users/table?${query.toString()}`);
}

/** `POST /users` — crea un usuario y devuelve su clave provisoria (única vez). */
export function createUser(dto: CreateUserDto): Promise<CreateUserResponse> {
  return request<CreateUserResponse>('/users', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/** `POST /users/import` — crea usuarios en lote (máx. 200). No aborta por fila mala. */
export function importUsers(rows: CreateUserDto[]): Promise<ImportUsersResponse> {
  return request<ImportUsersResponse>('/users/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

/**
 * `POST /users/:id/roles` — asigna un rol con alcance (`AssignRoleInput`).
 * 400 `INVALID_SCOPE_FOR_ROLE`/`INVALID_SCOPE_ID` si el alcance no es válido
 * para el rol. Devuelve la `UserRolesResponse` extendida (A4).
 */
export function assignUserRole(id: string, input: AssignRoleInput): Promise<UserRolesResponse> {
  return request<UserRolesResponse>(`/users/${encodeURIComponent(id)}/roles`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * `DELETE /users/:id/roles?roleKey=&scopeType=&scopeId=` — quita la membership
 * EXACTA indicada (H13: sin defaults de organización en el remove).
 */
export function removeUserRole(id: string, membership: UserMembership): Promise<UserRolesResponse> {
  const query = new URLSearchParams({
    roleKey: membership.roleKey,
    scopeType: membership.scopeType,
    scopeId: membership.scopeId,
  });
  return request<UserRolesResponse>(
    `/users/${encodeURIComponent(id)}/roles?${query.toString()}`,
    { method: 'DELETE' },
  );
}

/** `PATCH /users/:id/avatar` — sube la foto de perfil de un usuario. */
export function uploadUserAvatar(id: string, file: File): Promise<UserListItem> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadRequest<UserListItem>(
    `/users/${encodeURIComponent(id)}/avatar`,
    formData,
    'PATCH',
  );
}

/**
 * `GET /users/project-admins` — usuarios cuyo rol otorga el permiso de
 * administrador de proyecto (`project:manage`). Alimenta el selector
 * "Administrador de proyecto" del wizard de creación de proyectos (Capa 3).
 */
export function getProjectAdmins(): Promise<ProjectAdminOption[]> {
  return request<ProjectAdminOption[]>('/users/project-admins');
}

/**
 * `POST /users/:id/resend-invite` — regenera la clave provisoria de una
 * invitación NO usada y la devuelve (única vez, igual que al crear). 409 si la
 * invitación ya fue usada (el usuario ya completó su primer ingreso).
 */
export function resendUserInvitePreview(id: string): Promise<ResendInvitePreview> {
  return request<ResendInvitePreview>(`/users/${encodeURIComponent(id)}/resend-invite/preview`);
}

/**
 * `POST /users/:id/resend-invite` — regenera la clave provisoria. Con
 * `sendEmail: true` el servidor envía el correo (clave inyectada allí, NO
 * retornada); si no, retorna la clave una vez para compartirla a mano.
 */
export function resendUserInvite(id: string, input: ResendInviteInput): Promise<ResendInviteResult> {
  return request<ResendInviteResult>(
    `/users/${encodeURIComponent(id)}/resend-invite`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** `PATCH /users/:id` — edita el detalle de un usuario (admin). */
export function updateUserAdmin(id: string, input: UpdateUserAdminInput): Promise<UserListItem> {
  return request<UserListItem>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `DELETE /users/:id` — borra un usuario (admin). 409 si tiene registros asociados. */
export function deleteUser(id: string): Promise<void> {
  return request<void>(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* -------------------------------------------------------------------------- */
/* Detalle del trabajador (admin): CV (lectura), Horario/turnos, Documentos    */
/* -------------------------------------------------------------------------- */

/** `GET /users/:id/cv` — CV del trabajador en solo lectura. `null` si aún no tiene. */
export function fetchUserCv(id: string): Promise<CvView | null> {
  return request<CvView | null>(`/users/${encodeURIComponent(id)}/cv`);
}

/** `GET /users/:id/schedule` — jornada/turnos del trabajador. `null` si sin configurar. */
export function fetchUserSchedule(id: string): Promise<WorkScheduleView | null> {
  return request<WorkScheduleView | null>(`/users/${encodeURIComponent(id)}/schedule`);
}

/** `PUT /users/:id/schedule` — upsert de la jornada del trabajador (admin). */
export function upsertUserSchedule(
  id: string,
  input: UpsertWorkScheduleInput,
): Promise<WorkScheduleView> {
  return request<WorkScheduleView>(`/users/${encodeURIComponent(id)}/schedule`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** `GET /documents/user/:userId` — documentos de un trabajador (admin). */
export function fetchUserDocuments(userId: string): Promise<PersonalDocumentView[]> {
  return request<PersonalDocumentView[]>(`/documents/user/${encodeURIComponent(userId)}`);
}

/** `POST /documents/:id/approve` — aprueba un documento (revisor). */
export function approveDocument(id: string): Promise<PersonalDocumentView> {
  return request<PersonalDocumentView>(`/documents/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  });
}

/** `POST /documents/:id/reject` — rechaza un documento (revisor). `reason` opcional. */
export function rejectDocument(id: string, reason?: string): Promise<PersonalDocumentView> {
  return request<PersonalDocumentView>(`/documents/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? undefined }),
  });
}

/**
 * `POST /users/:id/revoke-invite` — revoca el acceso del usuario. Para un
 * usuario PENDING revoca la invitación; para un ACTIVE lo suspende y corta sus
 * sesiones. Devuelve el {@link UserListItem} ya suspendido.
 */
export function revokeUserInvite(id: string): Promise<UserListItem> {
  return request<UserListItem>(
    `/users/${encodeURIComponent(id)}/revoke-invite`,
    { method: 'POST' },
  );
}

/**
 * `POST /users/:id/revoke-sessions` — invalida las sesiones vivas del usuario sin
 * cambiar su estado. No devuelve cuerpo.
 */
export function revokeUserSessions(id: string): Promise<void> {
  return request<void>(
    `/users/${encodeURIComponent(id)}/revoke-sessions`,
    { method: 'POST' },
  );
}

/* -------------------------------------------------------------------------- */
/* Roles dinámicos (§Fase 5 — matriz RBAC)                                    */
/* -------------------------------------------------------------------------- */

/** `GET /permissions` — catálogo de permisos agrupado por módulo. */
export function getPermissionsCatalog(): Promise<PermissionCatalogGroup[]> {
  return request<PermissionCatalogGroup[]>('/permissions');
}

/** `GET /roles` — todos los roles (sistema + personalizados). */
export function listRoles(): Promise<RoleDetail[]> {
  return request<RoleDetail[]>('/roles');
}

/** `GET /roles/:key` — detalle de un rol. 404 si no existe. */
export function getRole(key: string): Promise<RoleDetail> {
  return request<RoleDetail>(`/roles/${encodeURIComponent(key)}`);
}

/** `POST /roles` — crea un rol personalizado. 400 en validaciones de grants. */
export function createRole(input: CreateRoleInput): Promise<RoleDetail> {
  return request<RoleDetail>('/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `PATCH /roles/:key` — edita un rol personalizado. 403 si es del sistema. */
export function updateRole(key: string, input: UpdateRoleInput): Promise<RoleDetail> {
  return request<RoleDetail>(`/roles/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `DELETE /roles/:key` — elimina un rol. 403 si es del sistema; 409 si está en uso. */
export function deleteRole(key: string): Promise<void> {
  return request<void>(`/roles/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

/**
 * `POST /roles/:key/clone` — clona un rol (incluye del sistema) a uno
 * personalizado nuevo. El backend filtra los grants NO componibles y los
 * reporta en `omittedPermissionKeys` (enmienda A7 — así clonar roles del
 * sistema como qa/operator/viewer/client_ito funciona; spec §6.2/§13.4).
 */
export function cloneRole(key: string, label: string): Promise<CloneRoleResponse> {
  return request<CloneRoleResponse>(`/roles/${encodeURIComponent(key)}/clone`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

/* -------------------------------------------------------------------------- */
/* Perfil propio (§6-1.3) — "Mis datos"                                        */
/* -------------------------------------------------------------------------- */

/** `GET /profile/me` — perfil propio del usuario autenticado. 401 sin sesión. */
export function getProfile(): Promise<ProfileMe> {
  return request<ProfileMe>('/profile/me');
}

/**
 * `PATCH /profile/me` — actualiza campos editables del perfil propio. El `email`
 * no es editable (campos extra → 400). Devuelve el perfil ya actualizado.
 */
export function updateProfile(input: UpdateProfileInput): Promise<ProfileMe> {
  return request<ProfileMe>('/profile/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * `POST /profile/change-password` — cambia la contraseña (endurecido). Exige la
 * contraseña actual (401 si es incorrecta), la nueva (mín. 8) y el OTP enviado a
 * su correo verificado (400 si es inválido/expirado). No devuelve datos de
 * interés más allá del éxito. Las claves nunca se registran.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  code: string,
): Promise<void> {
  const res = await request<{ ok: true; token: string }>('/profile/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword, code }),
  });
  // La clave nueva rota tokenVersion en el backend, que re-emite el JWT de ESTA
  // sesión. Guardarlo mantiene viva la sesión actual; las demás caen en 401.
  setToken(res.token);
}

/**
 * `POST /profile/password/change-request` — dispara el envío de un OTP de 6
 * dígitos al correo verificado del usuario. El código NO vuelve en la respuesta
 * (viaja solo por correo). Requisito previo de {@link changePassword}.
 */
export async function requestPasswordChange(): Promise<void> {
  await request<{ ok: true }>('/profile/password/change-request', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * `POST /profile/email/change-request` — exige la contraseña actual y pide un OTP
 * de 6 dígitos al `newEmail` para verificarlo antes de aplicarlo al campo `kind`
 * (INSTITUCIONAL | PERSONAL). El código NO vuelve en la respuesta (viaja solo por
 * correo). 401 si la contraseña actual es incorrecta; 409 si el correo ya está en
 * uso por otra cuenta.
 */
export async function requestEmailChange(
  newEmail: string,
  kind: EmailKind,
  currentPassword: string,
): Promise<void> {
  await request<{ ok: true }>('/profile/email/change-request', {
    method: 'POST',
    body: JSON.stringify({ newEmail, kind, currentPassword }),
  });
}

/**
 * `POST /profile/email/change-confirm` — confirma el cambio de correo con el OTP
 * recibido. 400 si el código es inválido/expirado. Devuelve el {@link ProfileMe}
 * ya actualizado (correo aplicado y marcado como verificado).
 */
export function confirmEmailChange(code: string): Promise<ProfileMe> {
  return request<ProfileMe>('/profile/email/change-confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/* -------------------------------------------------------------------------- */
/* Directorio (§6-1.6) — visible para cualquier usuario autenticado            */
/* -------------------------------------------------------------------------- */

/** `GET /directory?search=` — entradas del directorio scopeadas por permisos. */
export function listDirectory(search?: string): Promise<DirectoryEntry[]> {
  const query =
    search && search.trim().length > 0
      ? `?search=${encodeURIComponent(search.trim())}`
      : '';
  return request<DirectoryEntry[]>(`/directory${query}`);
}

/**
 * `GET /directory/table` — MOTOR de tablas server-side (offset) para el directorio.
 * Búsqueda, filtro `tipo` (colaborador/cliente) y orden sobre TODO el directorio
 * visible. Los filtros viajan como `filters[clave]=valor`.
 */
export function fetchDirectoryTable(req: TableRequest): Promise<TablePage<DirectoryEntry>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.search && req.search.trim().length > 0) query.set('search', req.search.trim());
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  if (req.filters) {
    for (const [key, value] of Object.entries(req.filters)) {
      if (value !== undefined && value !== '') query.set(`filters[${key}]`, value);
    }
  }
  return request<TablePage<DirectoryEntry>>(`/directory/table?${query.toString()}`);
}

/** `GET /directory/:id` — detalle básico. 404 si la entrada no es visible. */
export function getDirectoryEntry(id: string): Promise<DirectoryEntry> {
  return request<DirectoryEntry>(`/directory/${encodeURIComponent(id)}`);
}

/**
 * `GET /directory/:id/extended` — detalle extendido (status, points, segundos
 * nombres). 403 si no se tiene `directory:view:extended` (solo org_admin); el
 * llamador debe manejar ese 403 silenciosamente y mostrar solo el básico.
 */
export function getDirectoryExtended(id: string): Promise<DirectoryEntryExtended> {
  return request<DirectoryEntryExtended>(
    `/directory/${encodeURIComponent(id)}/extended`,
  );
}

/* -------------------------------------------------------------------------- */
/* Mi CV (§6-1.4) — experiencia, educación y certificaciones                   */
/* -------------------------------------------------------------------------- */

/** `GET /cv/me` — CV propio (se crea vacío de forma perezosa). 401 sin sesión. */
export function getCv(): Promise<CvView> {
  return request<CvView>('/cv/me');
}

/** `PATCH /cv/me` — actualiza el resumen del CV. Devuelve el CV completo. */
export function patchCv(input: { summary?: string }): Promise<CvView> {
  return request<CvView>('/cv/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `POST /cv/me/experiences` — agrega una experiencia. */
export function addExperience(input: CvExperienceInput): Promise<CvExperienceView> {
  return request<CvExperienceView>('/cv/me/experiences', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `PATCH /cv/me/experiences/:id` — edita una experiencia. */
export function updateExperience(
  id: string,
  input: CvExperienceInput,
): Promise<CvExperienceView> {
  return request<CvExperienceView>(`/cv/me/experiences/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `DELETE /cv/me/experiences/:id` — elimina una experiencia. */
export function deleteExperience(id: string): Promise<void> {
  return request<void>(`/cv/me/experiences/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** `POST /cv/me/education` — agrega una formación académica. */
export function addEducation(input: CvEducationInput): Promise<CvEducationView> {
  return request<CvEducationView>('/cv/me/education', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `PATCH /cv/me/education/:id` — edita una formación académica. */
export function updateEducation(
  id: string,
  input: CvEducationInput,
): Promise<CvEducationView> {
  return request<CvEducationView>(`/cv/me/education/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `DELETE /cv/me/education/:id` — elimina una formación académica. */
export function deleteEducation(id: string): Promise<void> {
  return request<void>(`/cv/me/education/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** `POST /cv/me/certifications` — agrega una certificación. */
export function addCertification(
  input: CvCertificationInput,
): Promise<CvCertificationView> {
  return request<CvCertificationView>('/cv/me/certifications', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `PATCH /cv/me/certifications/:id` — edita una certificación. */
export function updateCertification(
  id: string,
  input: CvCertificationInput,
): Promise<CvCertificationView> {
  return request<CvCertificationView>(
    `/cv/me/certifications/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** `DELETE /cv/me/certifications/:id` — elimina una certificación. */
export function deleteCertification(id: string): Promise<void> {
  return request<void>(`/cv/me/certifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * `POST /cv/me/certifications/:id/diploma` — sube el diploma (solo PDF) de una
 * certificación, vía multipart (campo `file`). Devuelve la certificación con su
 * `fileUrl` ya poblado.
 */
export function uploadDiploma(
  id: string,
  file: File,
): Promise<CvCertificationView> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadRequest<CvCertificationView>(
    `/cv/me/certifications/${encodeURIComponent(id)}/diploma`,
    formData,
  );
}

/* -------------------------------------------------------------------------- */
/* Mis documentos (§6-1.5) — vencimiento, filtros, versionado                  */
/* -------------------------------------------------------------------------- */

/** `GET /documents/me?status=&expiring=` — documentos personales del usuario. */
export function listDocuments(
  filters: DocumentFilters = {},
): Promise<PersonalDocumentView[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.expiring) params.set('expiring', 'true');
  const query = params.toString();
  return request<PersonalDocumentView[]>(
    `/documents/me${query ? `?${query}` : ''}`,
  );
}

/**
 * `GET /documents/me/table` — MOTOR de tablas server-side (offset) para "Mis
 * documentos". Filtro por estado y "por vencer", orden y paginación con total.
 * Los filtros viajan como `filters[clave]=valor`.
 */
export function fetchDocumentsTable(req: TableRequest): Promise<TablePage<PersonalDocumentView>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  if (req.filters) {
    for (const [key, value] of Object.entries(req.filters)) {
      if (value !== undefined && value !== '') query.set(`filters[${key}]`, value);
    }
  }
  return request<TablePage<PersonalDocumentView>>(`/documents/me/table?${query.toString()}`);
}

/**
 * `POST /documents/me` — sube un documento nuevo (PDF o imagen) vía multipart
 * (campo `file`) junto con sus metadatos. Queda en estado `EN_REVISION`.
 */
export function uploadDocument(
  fields: UploadDocumentFields,
  file: File,
): Promise<PersonalDocumentView> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', fields.type);
  formData.append('name', fields.name);
  if (fields.issuedAt) formData.append('issuedAt', fields.issuedAt);
  if (fields.expiresAt) formData.append('expiresAt', fields.expiresAt);
  return uploadRequest<PersonalDocumentView>('/documents/me', formData);
}

/**
 * `POST /documents/me/:id/version` — sube una versión nueva del documento
 * (campo `file`). Conserva `previousFileUrl` y vuelve a `EN_REVISION`.
 */
export function uploadDocumentVersion(
  id: string,
  file: File,
): Promise<PersonalDocumentView> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadRequest<PersonalDocumentView>(
    `/documents/me/${encodeURIComponent(id)}/version`,
    formData,
  );
}

/** `DELETE /documents/me/:id` — elimina un documento personal. */
export function deleteDocument(id: string): Promise<void> {
  return request<void>(`/documents/me/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard (§6-2.1) — widgets configurables por usuario                      */
/* -------------------------------------------------------------------------- */

/**
 * `GET /dashboard/me` — widgets disponibles (ya filtrados por permiso) + layout
 * reconciliado (orden 0..n-1). 401 sin sesión.
 */
export function getDashboard(): Promise<DashboardView> {
  return request<DashboardView>('/dashboard/me');
}

/**
 * `PUT /dashboard/me` — guarda el layout del propio usuario. Valida los
 * `widgetKey` (400 si alguno es desconocido/no disponible). Devuelve el mismo
 * shape que `getDashboard` (layout reconciliado).
 */
export function saveDashboard(layout: DashboardLayoutItem[]): Promise<DashboardView> {
  return request<DashboardView>('/dashboard/me', {
    method: 'PUT',
    body: JSON.stringify({ layout }),
  });
}

/* -------------------------------------------------------------------------- */
/* Notificaciones (§6-2.2) — in-app, propias del usuario                       */
/* -------------------------------------------------------------------------- */

/**
 * `GET /notifications?unreadOnly=` — notificaciones propias (createdAt desc).
 * `unreadOnly=true` filtra solo las no leídas.
 */
export function listNotifications(unreadOnly = false): Promise<NotificationView[]> {
  const query = unreadOnly ? '?unreadOnly=true' : '';
  return request<NotificationView[]>(`/notifications${query}`);
}

/** `GET /notifications/unread-count` — cantidad de notificaciones sin leer. */
export function getUnreadCount(): Promise<{ count: number }> {
  return request<{ count: number }>('/notifications/unread-count');
}

/** `POST /notifications/:id/read` — marca una propia como leída. 404 si es ajena. */
export function markNotificationRead(id: string): Promise<NotificationView> {
  return request<NotificationView>(
    `/notifications/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  );
}

/** `POST /notifications/read-all` — marca todas las no leídas. Retorna cuántas. */
export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return request<{ updated: number }>('/notifications/read-all', {
    method: 'POST',
  });
}

/* -------------------------------------------------------------------------- */
/* Ajustes propios (§6-2.3) — tema + preferencias de notificación             */
/* -------------------------------------------------------------------------- */

/** `GET /settings/me` — ajustes propios del usuario. Defaults perezosos. */
export function getSettings(): Promise<UserSettings> {
  return request<UserSettings>('/settings/me');
}

/** `PATCH /settings/me` — actualiza ajustes propios. Devuelve los ya aplicados. */
export function updateSettings(patch: UpdateSettingsInput): Promise<UserSettings> {
  return request<UserSettings>('/settings/me', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* -------------------------------------------------------------------------- */
/* Solicitudes de acceso a roles (§6-2.3)                                      */
/* -------------------------------------------------------------------------- */

/**
 * `POST /permission-requests` — solicita un rol. Queda en estado PENDIENTE.
 * 409 si ya hay una solicitud pendiente igual; 400 si el `roleKey` es inválido.
 */
export function createPermissionRequest(
  roleKey: RoleKey,
  reason?: string,
): Promise<PermissionRequestView> {
  const body: { roleKey: RoleKey; reason?: string } = { roleKey };
  if (reason && reason.trim().length > 0) body.reason = reason.trim();
  return request<PermissionRequestView>('/permission-requests', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** `GET /permission-requests/me` — solicitudes de acceso propias del usuario. */
export function listMyPermissionRequests(): Promise<PermissionRequestView[]> {
  return request<PermissionRequestView[]>('/permission-requests/me');
}

/**
 * `GET /permission-requests` — solicitudes PENDIENTES de todos. SOLO admin;
 * devuelve 403 si el solicitante no lo es (el llamador maneja ese 403 como
 * "no soy admin" sin romper la UI).
 */
export function listPendingPermissionRequests(): Promise<PermissionRequestAdminView[]> {
  return request<PermissionRequestAdminView[]>('/permission-requests');
}

/** `POST /permission-requests/:id/approve` — aprueba una solicitud. SOLO admin. */
export function approvePermissionRequest(id: string): Promise<PermissionRequestView> {
  return request<PermissionRequestView>(
    `/permission-requests/${encodeURIComponent(id)}/approve`,
    { method: 'POST' },
  );
}

/**
 * `POST /permission-requests/:id/reject` — rechaza una solicitud, con motivo
 * opcional. SOLO admin.
 */
export function rejectPermissionRequest(
  id: string,
  reason?: string,
): Promise<PermissionRequestView> {
  const body: { reason?: string } = {};
  if (reason && reason.trim().length > 0) body.reason = reason.trim();
  return request<PermissionRequestView>(
    `/permission-requests/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/* -------------------------------------------------------------------------- */
/* Finanzas (§6-3.1 Reembolsos / §6-3.3 Horas extra)                           */
/* -------------------------------------------------------------------------- */
/*
 * Rutas propias (`/me`, crear, boleta): cualquiera autenticado, "solo el dueño"
 * lo resuelve el backend con el userId de la sesión. Rutas de GESTIÓN (lista
 * global `GET /…`, approve/reject/pay): devuelven 403 si el usuario no es gestor
 * (`can_manage_finance`). El llamador maneja ese 403 como "no soy gestor" sin
 * romper la UI (probe silencioso). Las transiciones inválidas devuelven 409.
 */

/* --- Reembolsos --- */

/**
 * `POST /reimbursements` — crea un reembolso propio (PENDIENTE) con su boleta
 * OBLIGATORIA. Se envía como multipart (campo `file` PDF/imagen) para persistir el
 * respaldo de forma atómica; el backend rechaza con 400 si falta la boleta.
 */
export function createReimbursement(
  input: CreateReimbursementInput,
  file: File,
): Promise<ReimbursementView> {
  const formData = new FormData();
  formData.append('amount', String(input.amount));
  formData.append('date', input.date);
  formData.append('concept', input.concept);
  if (input.category) formData.append('category', input.category);
  if (input.subcategory) formData.append('subcategory', input.subcategory);
  if (input.vehicle) formData.append('vehicle', input.vehicle);
  if (input.observations) formData.append('observations', input.observations);
  formData.append('file', file);
  return uploadRequest<ReimbursementView>('/reimbursements', formData);
}

/**
 * `GET /reimbursements/me` — página de reembolsos propios con paginación keyset
 * (server-side, orden `createdAt desc`). Devuelve `{ items, nextCursor }`: para
 * la siguiente página se reenvía `nextCursor` como `cursor`. Filtro opcional de
 * estado. `limit` default 30, máx. 100.
 */
export function listMyReimbursements(
  params: { status?: FinanceStatus; limit?: number; cursor?: string } = {},
): Promise<Paginated<ReimbursementView>> {
  const query = new URLSearchParams();
  if (params.status) query.append('status', params.status);
  if (params.limit !== undefined) query.append('limit', String(params.limit));
  if (params.cursor) query.append('cursor', params.cursor);
  const qs = query.toString();
  return request<Paginated<ReimbursementView>>(`/reimbursements/me${qs ? `?${qs}` : ''}`);
}

/**
 * `GET /reimbursements?status=&userId=` — página de TODOS los reembolsos
 * (gestor) con paginación keyset (server-side, orden `date` configurable
 * asc/desc vía `order`). Devuelve 403 si no se tiene `can_manage_finance` (el
 * llamador lo trata como "no gestor" sin romper la UI). Las filas incluyen
 * `requester`. `limit` default 30, máx. 100.
 */
export interface ReimbursementListFilters {
  status?: FinanceStatus;
  userId?: string;
  /** ISO-8601. */
  dateFrom?: string;
  /** ISO-8601. */
  dateTo?: string;
  /** ISO-8601 (día exacto). */
  date?: string;
  /** "YYYY-MM" (mes contable, cierre día 20). */
  month?: string;
  order?: 'asc' | 'desc';
  /** Selector "pendientes de impresión". */
  printed?: boolean;
  /** Tope de filas de la página (default 30, máx. 100). */
  limit?: number;
  /** Cursor keyset opaco de la página siguiente (`Paginated.nextCursor`). */
  cursor?: string;
}

export function listAllReimbursements(
  filters: ReimbursementListFilters,
): Promise<Paginated<ReimbursementView>> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.date) params.set('date', filters.date);
  if (filters.month) params.set('month', filters.month);
  if (filters.order) params.set('order', filters.order);
  if (filters.printed !== undefined) params.set('printed', String(filters.printed));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.cursor) params.set('cursor', filters.cursor);
  const query = params.toString();
  return request<Paginated<ReimbursementView>>(`/reimbursements${query ? `?${query}` : ''}`);
}

/**
 * `GET /reimbursements/table` — MOTOR de tablas server-side (offset) para la
 * Gestión de reembolsos. Filtro por estado y orden sobre TODOS los reembolsos.
 * Mismo gate que `listAllReimbursements` (403 si no es gestor). Los filtros viajan
 * como `filters[clave]=valor`.
 */
export function fetchReimbursementsTable(req: TableRequest): Promise<TablePage<ReimbursementView>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  if (req.filters) {
    for (const [key, value] of Object.entries(req.filters)) {
      if (value !== undefined && value !== '') query.set(`filters[${key}]`, value);
    }
  }
  return request<TablePage<ReimbursementView>>(`/reimbursements/table?${query.toString()}`);
}

/**
 * `GET /reimbursements/summary` — totales agregados por el servidor (§5.2). Solo
 * gestores (403 si no). C2 agrega client-side, pero el wrapper queda disponible.
 */
export function reimbursementsSummary(
  filters: ReimbursementListFilters = {},
): Promise<unknown> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.date) params.set('date', filters.date);
  if (filters.month) params.set('month', filters.month);
  const query = params.toString();
  return request<unknown>(`/reimbursements/summary${query ? `?${query}` : ''}`);
}

/**
 * `POST /reimbursements/:id/receipt` — sube/actualiza la boleta (multipart, campo
 * `file` PDF/imagen). SOLO el dueño y solo si está PENDIENTE. Devuelve el
 * reembolso con su `receiptUrl` ya poblado.
 */
export function attachReimbursementReceipt(
  id: string,
  file: File,
): Promise<ReimbursementView> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadRequest<ReimbursementView>(
    `/reimbursements/${encodeURIComponent(id)}/receipt`,
    formData,
  );
}

/** `POST /reimbursements/:id/approve` — aprueba (gestor). PENDIENTE→APROBADO; 409 si no. */
export function approveReimbursement(id: string): Promise<ReimbursementView> {
  return request<ReimbursementView>(
    `/reimbursements/${encodeURIComponent(id)}/approve`,
    { method: 'POST' },
  );
}

/**
 * `POST /reimbursements/:id/reject` — rechaza (gestor), con motivo opcional.
 * PENDIENTE→RECHAZADO; 409 si el estado no lo permite.
 */
export function rejectReimbursement(
  id: string,
  reason?: string,
): Promise<ReimbursementView> {
  const body: { reason?: string } = {};
  if (reason && reason.trim().length > 0) body.reason = reason.trim();
  return request<ReimbursementView>(
    `/reimbursements/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** `POST /reimbursements/:id/pay` — marca pagado (gestor). APROBADO→PAGADO; 409 si no. */
export function payReimbursement(id: string): Promise<ReimbursementView> {
  return request<ReimbursementView>(
    `/reimbursements/${encodeURIComponent(id)}/pay`,
    { method: 'POST' },
  );
}

/**
 * `PUT /reimbursements/:id` — edita un reembolso propio (SOLO el dueño y solo si
 * está PENDIENTE). Reutiliza el DTO de creación (la boleta se cambia aparte con
 * {@link attachReimbursementReceipt}). Devuelve el reembolso actualizado.
 */
export function updateReimbursement(
  id: string,
  input: CreateReimbursementInput,
): Promise<ReimbursementView> {
  return request<ReimbursementView>(`/reimbursements/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * `DELETE /reimbursements/:id` — elimina un reembolso propio (SOLO el dueño y
 * solo si está PENDIENTE). No devuelve cuerpo.
 */
export function deleteReimbursement(id: string): Promise<void> {
  return request<void>(`/reimbursements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Orientación de página del PDF de impresión en lote (espeja el DTO del backend). */
export type PrintOrientation = 'portrait' | 'landscape';
/** Tamaño de hoja del PDF de impresión en lote (espeja el DTO del backend). */
export type PrintPageSize = 'A4' | 'letter';

/** Resultado del OCR de boleta (`POST /reimbursements/scan-receipt`). Parcial. */
export interface ReceiptScanResult {
  concept?: string;
  amount?: number;
  /** "YYYY-MM-DD". */
  date?: string;
  category?: string;
}

/**
 * `POST /reimbursements/scan-receipt` — OCR NVIDIA de la boleta (multipart `file`).
 * Devuelve campos sugeridos (parciales); el usuario los corrige antes de crear.
 */
export function scanReceipt(file: File): Promise<ReceiptScanResult> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadRequest<ReceiptScanResult>('/reimbursements/scan-receipt', formData);
}

/**
 * `POST /reimbursements/print` — genera en el SERVIDOR un PDF con las boletas de
 * los reembolsos indicados, en grilla de `perPage` (2/4/6) por página, con
 * `orientation` y `size` opcionales (§5.7). Solo gestores (403 si no). Devuelve el
 * PDF como `Blob`. NO marca impresas: eso lo hace `markReimbursementsPrinted`.
 */
export async function downloadReimbursementsPdf(
  ids: string[],
  perPage: 2 | 4 | 6,
  orientation: PrintOrientation = 'portrait',
  size: PrintPageSize = 'A4',
): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_URL}/reimbursements/print`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids, perPage, orientation, size }),
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // sin cuerpo JSON
    }
    throw new ApiError(extractMessage(body, `Error ${res.status} al generar el PDF.`), res.status);
  }
  return res.blob();
}

/**
 * `POST /reimbursements/print/mark` — marca `printedAt` en cada reembolso tras una
 * descarga confirmada (§5.7). Solo gestores (403 si no). Devuelve cuántas marcó.
 */
export function markReimbursementsPrinted(ids: string[]): Promise<{ marked: number }> {
  return request<{ marked: number }>('/reimbursements/print/mark', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

/* --- Horas extra --- */

/** `POST /overtime` — crea una solicitud de horas extra propia (PENDIENTE). */
export function createOvertime(input: CreateOvertimeInput): Promise<OvertimeView> {
  return request<OvertimeView>('/overtime', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * `GET /overtime/me` — página de solicitudes propias con paginación keyset
 * (server-side, orden `createdAt desc`). Devuelve `{ items, nextCursor }`: para
 * la siguiente página se reenvía `nextCursor` como `cursor`. Filtro opcional de
 * estado. `limit` default 30, máx. 100.
 */
export function listMyOvertime(
  params: { status?: FinanceStatus; limit?: number; cursor?: string } = {},
): Promise<Paginated<OvertimeView>> {
  const query = new URLSearchParams();
  if (params.status) query.append('status', params.status);
  if (params.limit !== undefined) query.append('limit', String(params.limit));
  if (params.cursor) query.append('cursor', params.cursor);
  const qs = query.toString();
  return request<Paginated<OvertimeView>>(`/overtime/me${qs ? `?${qs}` : ''}`);
}

/**
 * `GET /overtime?status=&userId=` — página de TODAS las solicitudes (gestor)
 * con paginación keyset (server-side, orden `date` configurable asc/desc vía
 * `order`). Devuelve 403 si no se tiene `can_manage_finance` (el llamador lo
 * trata como "no gestor" sin romper la UI). Las filas incluyen `requester`.
 * `limit` default 30, máx. 100.
 */
export interface OvertimeListFilters {
  status?: FinanceStatus;
  userId?: string;
  projectId?: string;
  clientId?: string;
  /** ISO-8601. */
  dateFrom?: string;
  /** ISO-8601. */
  dateTo?: string;
  /** ISO-8601 (día exacto). */
  date?: string;
  /** "YYYY-MM" (mes contable, cierre día 20). */
  month?: string;
  order?: 'asc' | 'desc';
  /** Tope de filas de la página (default 30, máx. 100). */
  limit?: number;
  /** Cursor keyset opaco de la página siguiente (`Paginated.nextCursor`). */
  cursor?: string;
}

export function listAllOvertime(
  filters: OvertimeListFilters,
): Promise<Paginated<OvertimeView>> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.clientId) params.set('clientId', filters.clientId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.date) params.set('date', filters.date);
  if (filters.month) params.set('month', filters.month);
  if (filters.order) params.set('order', filters.order);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.cursor) params.set('cursor', filters.cursor);
  const query = params.toString();
  return request<Paginated<OvertimeView>>(`/overtime${query ? `?${query}` : ''}`);
}

/**
 * `GET /overtime/table` — MOTOR de tablas server-side (offset) para la Gestión de
 * horas extra. Filtro por estado y orden sobre TODAS las horas extra. Mismo gate
 * que `listAllOvertime` (403 si no es gestor). Los filtros viajan como
 * `filters[clave]=valor`.
 */
export function fetchOvertimeTable(req: TableRequest): Promise<TablePage<OvertimeView>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  if (req.filters) {
    for (const [key, value] of Object.entries(req.filters)) {
      if (value !== undefined && value !== '') query.set(`filters[${key}]`, value);
    }
  }
  return request<TablePage<OvertimeView>>(`/overtime/table?${query.toString()}`);
}

/**
 * `GET /overtime/summary` — totales agregados por el servidor (§5.2). Solo gestores
 * (403 si no). C2 agrega client-side, pero el wrapper queda disponible.
 */
export function overtimeSummary(filters: OvertimeListFilters = {}): Promise<unknown> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.clientId) params.set('clientId', filters.clientId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.date) params.set('date', filters.date);
  if (filters.month) params.set('month', filters.month);
  const query = params.toString();
  return request<unknown>(`/overtime/summary${query ? `?${query}` : ''}`);
}

/**
 * `POST /overtime/:id/close` — cierra un BORRADOR agregando la hora de término.
 * BORRADOR→PENDIENTE; 409 si el estado no lo permite.
 */
export function closeOvertime(id: string, endTime: string): Promise<OvertimeView> {
  return request<OvertimeView>(
    `/overtime/${encodeURIComponent(id)}/close`,
    { method: 'POST', body: JSON.stringify({ endTime }) },
  );
}

/** `POST /overtime/:id/approve` — aprueba (gestor). PENDIENTE→APROBADO; 409 si no. */
export function approveOvertime(id: string): Promise<OvertimeView> {
  return request<OvertimeView>(
    `/overtime/${encodeURIComponent(id)}/approve`,
    { method: 'POST' },
  );
}

/**
 * `POST /overtime/:id/reject` — rechaza (gestor), con motivo opcional.
 * PENDIENTE→RECHAZADO; 409 si el estado no lo permite.
 */
export function rejectOvertime(
  id: string,
  reason?: string,
): Promise<OvertimeView> {
  const body: { reason?: string } = {};
  if (reason && reason.trim().length > 0) body.reason = reason.trim();
  return request<OvertimeView>(
    `/overtime/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** `POST /overtime/:id/pay` — marca pagada (gestor). APROBADO→PAGADO; 409 si no. */
export function payOvertime(id: string): Promise<OvertimeView> {
  return request<OvertimeView>(
    `/overtime/${encodeURIComponent(id)}/pay`,
    { method: 'POST' },
  );
}

/**
 * `PUT /overtime/:id` — edita una HE propia (SOLO el dueño y solo si está
 * PENDIENTE). Las horas se recomputan de `startTime`/`endTime` server-side.
 * Devuelve la solicitud actualizada.
 */
export function updateOvertime(
  id: string,
  input: UpdateOvertimeInput,
): Promise<OvertimeView> {
  return request<OvertimeView>(`/overtime/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * `DELETE /overtime/:id` — elimina una HE propia (SOLO el dueño y solo si está
 * PENDIENTE). No devuelve cuerpo.
 */
export function deleteOvertime(id: string): Promise<void> {
  return request<void>(`/overtime/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* --- Proyectos --- */

/**
 * `GET /projects[?faenaId=]` — lista de proyectos. Sin argumentos devuelve todos
 * (uso legacy en Operaciones / V-Metric / roles-dialog). Con `faenaId` filtra por
 * faena (Capa 3 de la jerarquía A0 Cliente → Faena → Proyecto).
 */
export function listProjects(faenaId?: string): Promise<ProjectView[]> {
  const query = faenaId ? `?faenaId=${encodeURIComponent(faenaId)}` : '';
  return request<ProjectView[]>(`/projects${query}`);
}

export function listDepartments(): Promise<Array<{ id: string; name: string; code: string }>> {
  return request<Array<{ id: string; name: string; code: string }>>('/projects/departments');
}

/**
 * `POST /projects` — crea un proyecto. Acepta el DTO legacy de Operaciones
 * (`{code,name,departmentId,clientId}`) o el `CreateProjectInput` extendido de la
 * jerarquía A0 (`contractNumber`/`projectType`/`faenaId`/`projectAdminId`). El
 * backend valida los gates y campos según el shape recibido.
 */
export function createProject(
  dto:
    | { code: string; name: string; departmentId: string; clientId: string }
    | CreateProjectInput,
): Promise<ProjectView> {
  return request<ProjectView>('/projects', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * Crea un servicio ELIGIENDO UN TIPO del catálogo (Tanda 4). El código corto (§7)
 * y la config de firma se derivan del tipo en el servidor; `name` es opcional
 * (default = nombre del tipo).
 */
export function createService(
  projectId: string,
  dto: CreateServiceByTypeInput,
): Promise<ServiceView> {
  return request<ServiceView>(`/projects/${encodeURIComponent(projectId)}/services`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/* --- Catálogo de tipos de servicio (Tanda 4) --- */

/** `GET /service-types` — catálogo de tipos de servicio. `includeInactive` para el admin. */
export function fetchServiceTypes(includeInactive = false): Promise<ServiceTypeView[]> {
  const query = includeInactive ? '?includeInactive=true' : '';
  return request<ServiceTypeView[]>(`/service-types${query}`);
}

/** `POST /service-types` — crea un tipo de servicio (gate `service_type:manage`). */
export function createServiceType(input: CreateServiceTypeInput): Promise<ServiceTypeView> {
  return request<ServiceTypeView>('/service-types', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `PATCH /service-types/:id` — edita un tipo de servicio. */
export function updateServiceType(id: string, input: UpdateServiceTypeInput): Promise<ServiceTypeView> {
  return request<ServiceTypeView>(`/service-types/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `DELETE /service-types/:id` — borra un tipo (409 si está en uso; desactívalo en su lugar). */
export function deleteServiceType(id: string): Promise<void> {
  return request<void>(`/service-types/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function updateProjectKpis(projectId: string, kpis: Record<string, unknown>): Promise<ProjectView> {
  return request<ProjectView>(`/projects/${encodeURIComponent(projectId)}/kpis`, {
    method: 'PUT',
    body: JSON.stringify({ kpis }),
  });
}

/* --- Backlog / Tareas --- */

export function listTasks(filters: {
  projectId?: string;
  serviceId?: string;
  status?: TaskStatus;
  assignedToId?: string | null;
  search?: string;
}): Promise<TaskView[]> {
  const query = new URLSearchParams();
  if (filters.projectId) query.append('projectId', filters.projectId);
  if (filters.serviceId) query.append('serviceId', filters.serviceId);
  if (filters.status) query.append('status', filters.status);
  if (filters.assignedToId) query.append('assignedToId', filters.assignedToId);
  if (filters.search) query.append('search', filters.search);

  const qs = query.toString();
  return request<TaskView[]>(`/tasks${qs ? `?${qs}` : ''}`);
}

/**
 * `GET /tasks/table` — MOTOR de tablas server-side (offset) para el backlog.
 * Búsqueda, filtros (project/service/assignee/status) y orden sobre TODO el
 * backlog visible. Lo consume la vista Tabla. Los filtros viajan como
 * `filters[clave]=valor`.
 */
export function fetchTasksTable(req: TableRequest): Promise<TablePage<TaskView>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.search && req.search.trim().length > 0) query.set('search', req.search.trim());
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  if (req.filters) {
    for (const [key, value] of Object.entries(req.filters)) {
      if (value !== undefined && value !== '') query.set(`filters[${key}]`, value);
    }
  }
  return request<TablePage<TaskView>>(`/tasks/table?${query.toString()}`);
}

export function createTask(dto: {
  name: string;
  description?: string;
  projectId: string;
  serviceId?: string;
  assignedToId?: string;
  estimatedPoints?: number;
  recurrence?: string;
  clientUserId?: string;
}): Promise<TaskView> {
  return request<TaskView>('/tasks', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function updateTask(
  id: string,
  dto: {
    name?: string;
    description?: string;
    assignedToId?: string;
    estimatedPoints?: number;
    actualPoints?: number;
    recurrence?: string;
    clientUserId?: string;
  },
): Promise<TaskView> {
  return request<TaskView>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

export function updateTaskStatus(id: string, status: TaskStatus, actualPoints?: number): Promise<TaskView> {
  return request<TaskView>(`/tasks/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, actualPoints }),
  });
}

export function deleteTask(id: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function startTaskTime(id: string, note?: string): Promise<TaskTimeLogView> {
  return request<TaskTimeLogView>(`/tasks/${encodeURIComponent(id)}/time/start`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function finishTaskTime(id: string, note?: string): Promise<TaskTimeLogView> {
  return request<TaskTimeLogView>(`/tasks/${encodeURIComponent(id)}/time/finish`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function getTaskAssignees(projectId: string): Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>> {
  return request<Array<{ id: string; firstName: string; lastName: string; email: string }>>(`/tasks/assignees?projectId=${encodeURIComponent(projectId)}`);
}

/* --- Documentos de Proyecto --- */

export function listProjectDocuments(projectId?: string, serviceId?: string): Promise<ProjectDocumentView[]> {
  const query = new URLSearchParams();
  if (projectId) query.append('projectId', projectId);
  if (serviceId) query.append('serviceId', serviceId);
  const qs = query.toString();
  return request<ProjectDocumentView[]>(`/project-documents${qs ? `?${qs}` : ''}`);
}

export function uploadProjectDocument(
  dto: {
    name: string;
    projectId: string;
    serviceId: string;
    documentType: string;
    areaCode: string;
  },
  file: File,
): Promise<ProjectDocumentView> {
  const formData = new FormData();
  formData.append('name', dto.name);
  formData.append('projectId', dto.projectId);
  formData.append('serviceId', dto.serviceId);
  formData.append('documentType', dto.documentType);
  formData.append('areaCode', dto.areaCode);
  formData.append('file', file);
  return uploadRequest<ProjectDocumentView>('/project-documents', formData);
}

export function uploadProjectDocumentRevision(id: string, file: File): Promise<ProjectDocumentView> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadRequest<ProjectDocumentView>(`/project-documents/${encodeURIComponent(id)}/revision`, formData);
}

export function signProjectDocumentQA(id: string): Promise<ProjectDocumentView> {
  return request<ProjectDocumentView>(`/project-documents/${encodeURIComponent(id)}/sign-qa`, {
    method: 'POST',
  });
}

export function signProjectDocumentClient(id: string): Promise<ProjectDocumentView> {
  return request<ProjectDocumentView>(`/project-documents/${encodeURIComponent(id)}/sign-client`, {
    method: 'POST',
  });
}

export function rejectProjectDocument(id: string, reason: string): Promise<ProjectDocumentView> {
  return request<ProjectDocumentView>(`/project-documents/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function deleteProjectDocument(id: string): Promise<void> {
  return request<void>(`/project-documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Recursos / Activos (§6-5.1) — primitiva AssetBase                         */
/* -------------------------------------------------------------------------- */

/**
 * `GET /assets` — página de activos con paginación keyset (server-side). Devuelve
 * `{ items, nextCursor }`: para la siguiente página se reenvía `nextCursor` como
 * `cursor`. `search` filtra server-side por código / nombre / descripción; `type`
 * / `status` / `projectId` filtran por esos campos. `limit` default 30, máx. 100.
 */
export function listAssets(params: {
  limit?: number;
  cursor?: string;
  search?: string;
  type?: AssetType;
  status?: AssetStatus;
  projectId?: string;
} = {}): Promise<Paginated<AssetView>> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.append('limit', String(params.limit));
  if (params.cursor) query.append('cursor', params.cursor);
  if (params.search && params.search.trim().length > 0) query.append('search', params.search.trim());
  if (params.type) query.append('type', params.type);
  if (params.status) query.append('status', params.status);
  if (params.projectId) query.append('projectId', params.projectId);
  const qs = query.toString();
  return request<Paginated<AssetView>>(`/assets${qs ? `?${qs}` : ''}`);
}

/**
 * `GET /assets/table` — MOTOR de tablas server-side (offset) para el catálogo de
 * activos. Búsqueda, filtro (type/status/projectId) y orden se resuelven en el
 * servidor sobre TODO el dataset visible. Los filtros viajan como `filters[clave]=valor`.
 */
export function fetchAssetsTable(req: TableRequest): Promise<TablePage<AssetView>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.search && req.search.trim().length > 0) query.set('search', req.search.trim());
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  if (req.filters) {
    for (const [key, value] of Object.entries(req.filters)) {
      if (value !== undefined && value !== '') query.set(`filters[${key}]`, value);
    }
  }
  return request<TablePage<AssetView>>(`/assets/table?${query.toString()}`);
}

export function createAsset(dto: CreateAssetInput): Promise<AssetView> {
  return request<AssetView>('/assets', {
    method: 'POST',
    body: JSON.stringify({
      type: dto.type,
      name: dto.name,
      description: dto.description,
      manufacturer: dto.manufacturer,
      identifier: dto.identifier,
      identifierType: dto.identifierType,
      vehicleSubtype: dto.vehicleSubtype,
      projectId: dto.projectId,
      assignedToId: dto.assignedToId,
      metadata: dto.metadata,
    }),
  });
}

export function getAsset(id: string): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}`);
}

/** `PATCH /assets/:id` — edita los campos descriptivos del activo (Tanda 5.2). */
export function updateAsset(id: string, input: UpdateAssetInput): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getPublicAsset(token: string): Promise<AssetPublicView> {
  return request<AssetPublicView>(`/assets/public/${encodeURIComponent(token)}`);
}

export function updateAssetStatus(
  id: string,
  status: AssetStatus,
  description?: string,
): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, description }),
  });
}

export function assignAsset(id: string, assignedToId: string | null): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}/assign`, {
    method: 'PUT',
    body: JSON.stringify({ assignedToId }),
  });
}

export function takeAssetUse(id: string): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}/use`, {
    method: 'POST',
  });
}

export function releaseAssetUse(id: string): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}/release`, {
    method: 'POST',
  });
}

export function uploadAssetDocument(
  id: string,
  name: string,
  type: string,
  file: File,
  expirationDate?: string,
): Promise<AssetDocumentView> {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('type', type);
  formData.append('file', file);
  if (expirationDate) formData.append('expirationDate', expirationDate);
  return uploadRequest<AssetDocumentView>(`/assets/${encodeURIComponent(id)}/documents`, formData);
}

export function listAssetDocuments(id: string): Promise<AssetDocumentView[]> {
  return request<AssetDocumentView[]>(`/assets/${encodeURIComponent(id)}/documents`);
}

export function reviewAssetDocument(
  id: string,
  docId: string,
  dto: ReviewAssetDocInput,
): Promise<AssetDocumentView> {
  return request<AssetDocumentView>(
    `/assets/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    },
  );
}

export function getAssetHistory(id: string): Promise<AssetHistoryEntryView[]> {
  return request<AssetHistoryEntryView[]>(`/assets/${encodeURIComponent(id)}/history`);
}

export function listAssetAccessories(id: string): Promise<AssetAccessoryView[]> {
  return request<AssetAccessoryView[]>(`/assets/${encodeURIComponent(id)}/accessories`);
}

export function addAssetAccessory(id: string, dto: CreateAccessoryInput): Promise<AssetAccessoryView> {
  return request<AssetAccessoryView>(`/assets/${encodeURIComponent(id)}/accessories`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function updateAssetAccessory(
  id: string,
  accId: string,
  dto: UpdateAccessoryInput,
): Promise<AssetAccessoryView> {
  return request<AssetAccessoryView>(
    `/assets/${encodeURIComponent(id)}/accessories/${encodeURIComponent(accId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(dto),
    },
  );
}

export function removeAssetAccessory(id: string, accId: string): Promise<void> {
  return request<void>(
    `/assets/${encodeURIComponent(id)}/accessories/${encodeURIComponent(accId)}`,
    {
      method: 'DELETE',
    },
  );
}

export function getChecklistTemplate(id: string): Promise<ChecklistTemplateView> {
  return request<ChecklistTemplateView>(`/assets/${encodeURIComponent(id)}/checklist/template`);
}

export function updateChecklistTemplate(
  id: string,
  dto: UpdateChecklistTemplateInput,
): Promise<ChecklistTemplateView> {
  return request<ChecklistTemplateView>(`/assets/${encodeURIComponent(id)}/checklist/template`, {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

export function reviewChecklistTemplate(
  id: string,
  dto: ReviewChecklistTemplateInput,
): Promise<ChecklistTemplateView> {
  return request<ChecklistTemplateView>(`/assets/${encodeURIComponent(id)}/checklist/template/review`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function submitChecklist(id: string, dto: SubmitChecklistInput): Promise<ChecklistSubmissionView> {
  return request<ChecklistSubmissionView>(`/assets/${encodeURIComponent(id)}/checklist/submit`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function listChecklistSubmissions(id: string): Promise<ChecklistSubmissionView[]> {
  return request<ChecklistSubmissionView[]>(`/assets/${encodeURIComponent(id)}/checklist/submissions`);
}

/**
 * `GET /assets/:id/checklist/submissions/:submissionId/pdf`: genera en el
 * SERVIDOR el PDF de una inspección de checklist (plantilla + respuestas) y lo
 * devuelve como `Blob` para descargar. Mismo permiso que ver el activo. El
 * llamador arma el objeto de descarga (`URL.createObjectURL`).
 */
export async function downloadChecklistPdf(
  assetId: string,
  submissionId: string,
): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}/assets/${encodeURIComponent(assetId)}/checklist/submissions/${encodeURIComponent(submissionId)}/pdf`,
      { headers },
    );
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // sin cuerpo JSON
    }
    throw new ApiError(extractMessage(body, `Error ${res.status} al generar el PDF.`), res.status);
  }
  return res.blob();
}

export function submitTelemetry(
  id: string,
  dto: { latitude: number; longitude: number; speed: number },
): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}/telemetry`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// ============ RECURSOS: BODEGAS, INSUMOS, PROVEEDORES Y HERRAMIENTAS GIS ============

export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplyView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
  provider?: { id: string; name: string } | null;
}

export interface WarehouseStockView {
  warehouseId: string;
  supplyId: string;
  quantity: number;
  supply?: SupplyView;
}

export interface WarehouseTransactionView {
  id: string;
  warehouseId: string;
  supplyId: string;
  type: 'ENTRY' | 'EXIT';
  quantity: number;
  reason: string | null;
  actorId: string | null;
  createdAt: string;
  supply?: SupplyView;
  actor?: { firstName: string; lastName: string } | null;
}

export interface ProviderView {
  id: string;
  rut: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  score: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProductView {
  id: string;
  providerId: string;
  name: string;
  description: string | null;
  price: number | null;
  unit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRatingView {
  id: string;
  providerId: string;
  score: number;
  comment: string | null;
  actorId: string;
  createdAt: string;
  actor?: { firstName: string; lastName: string } | null;
}

export function createWarehouse(dto: { code: string; name: string; location?: string }): Promise<WarehouseView> {
  return request<WarehouseView>('/warehouses', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function listWarehouses(): Promise<WarehouseView[]> {
  return request<WarehouseView[]>('/warehouses');
}

export function getWarehouseById(id: string): Promise<{
  warehouse: WarehouseView;
  stocks: WarehouseStockView[];
  transactions: WarehouseTransactionView[];
}> {
  return request<{
    warehouse: WarehouseView;
    stocks: WarehouseStockView[];
    transactions: WarehouseTransactionView[];
  }>(`/warehouses/${encodeURIComponent(id)}`);
}

/**
 * `GET /warehouses/:id/transactions` — MOTOR de tablas server-side (offset) para
 * los movimientos de una bodega. Reemplaza el corte a 50 de `getWarehouseById`:
 * orden y paginación con total sobre todos los movimientos.
 */
export function fetchWarehouseTransactionsTable(
  warehouseId: string,
  req: TableRequest,
): Promise<TablePage<WarehouseTransactionView>> {
  const query = new URLSearchParams();
  query.set('page', String(req.page));
  query.set('pageSize', String(req.pageSize));
  if (req.sortBy) query.set('sortBy', req.sortBy);
  if (req.sortDir) query.set('sortDir', req.sortDir);
  return request<TablePage<WarehouseTransactionView>>(
    `/warehouses/${encodeURIComponent(warehouseId)}/transactions?${query.toString()}`,
  );
}

export function createSupply(dto: {
  code: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  providerId?: string;
}): Promise<SupplyView> {
  return request<SupplyView>('/supplies', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function listSupplies(search?: string, category?: string): Promise<SupplyView[]> {
  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (category) params.append('category', category);
  const queryStr = params.toString();
  return request<SupplyView[]>(`/supplies${queryStr ? `?${queryStr}` : ''}`);
}

export function registerWarehouseTransaction(
  warehouseId: string,
  dto: { supplyId: string; type: 'ENTRY' | 'EXIT'; quantity: number; reason?: string },
): Promise<WarehouseTransactionView> {
  return request<WarehouseTransactionView>(`/warehouses/${encodeURIComponent(warehouseId)}/transactions`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function importSupplies(dto: { items: unknown[] }): Promise<{ count: number }> {
  return request<{ count: number }>('/supplies/import', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function createProvider(dto: {
  rut?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}): Promise<ProviderView> {
  return request<ProviderView>('/providers', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function listProviders(): Promise<ProviderView[]> {
  return request<ProviderView[]>('/providers');
}

export function getProviderById(id: string): Promise<{
  provider: ProviderView;
  products: ProviderProductView[];
  ratings: ProviderRatingView[];
}> {
  return request<{
    provider: ProviderView;
    products: ProviderProductView[];
    ratings: ProviderRatingView[];
  }>(`/providers/${encodeURIComponent(id)}`);
}

export function addProviderProduct(
  providerId: string,
  dto: { name: string; description?: string; price?: number; unit?: string },
): Promise<ProviderProductView> {
  return request<ProviderProductView>(`/providers/${encodeURIComponent(providerId)}/products`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function submitProviderRating(
  providerId: string,
  dto: { score: number; comment?: string },
): Promise<ProviderRatingView> {
  return request<ProviderRatingView>(`/providers/${encodeURIComponent(providerId)}/ratings`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function cleanProviderDataWithIA(dto: { rawData: string }): Promise<{
  name: string;
  rut?: string;
  email?: string;
  phone?: string;
  address?: string;
  products: Array<{ name: string; description?: string; price?: number; unit?: string }>;
}> {
  return request<{
    name: string;
    rut?: string;
    email?: string;
    phone?: string;
    address?: string;
    products: Array<{ name: string; description?: string; price?: number; unit?: string }>;
  }>('/providers/clean-data', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export interface ConvertPointInput {
  direction: 'UTM_TO_LL' | 'LL_TO_UTM';
  latitude?: number;
  longitude?: number;
  easting?: number;
  northing?: number;
  zone?: number;
  southernHemisphere?: boolean;
}

export interface ConvertPointResult {
  direction: 'UTM_TO_LL' | 'LL_TO_UTM';
  latitude?: number;
  longitude?: number;
  easting?: number;
  northing?: number;
  zone?: number;
  southernHemisphere?: boolean;
}

export function convertCoordinate(dto: ConvertPointInput): Promise<ConvertPointResult> {
  return request<ConvertPointResult>('/tools/coords/convert', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function convertCoordinatesBulk(dto: { points: ConvertPointInput[] }): Promise<ConvertPointResult[]> {
  return request<ConvertPointResult[]>('/tools/coords/convert/bulk', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function detectShorelineWithIA(dto: { fileBase64: string }): Promise<{ polygon: Array<{ x: number; y: number }> }> {
  return request<{ polygon: Array<{ x: number; y: number }> }>('/tools/gis/shore-detect', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function getGeminiQuota(): Promise<{ used: number; remaining: number }> {
  return request<{ used: number; remaining: number }>('/tools/gis/quota');
}

/* -------------------------------------------------------------------------- */
/* Gamificación (§6-7.1)                                                      */
/* -------------------------------------------------------------------------- */

export interface GamificationUnlocked {
  key: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string;
}

export interface GamificationProgress {
  key: string;
  title: string;
  description: string;
  icon: string;
  current: number;
  target: number;
}

export interface GamificationProfile {
  points: number;
  periodPoints: number;
  rank: 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO';
  rankProgress: number;
  nextRank: string;
  unlocked: GamificationUnlocked[];
  progress: GamificationProgress[];
  recentPoints: Array<{ action: string; points: number; createdAt: string }>;
}

export function getGamificationProfile(): Promise<GamificationProfile> {
  return request<GamificationProfile>('/gamification/profile');
}

/* -------------------------------------------------------------------------- */
/* Métricas Jerárquicas (V-Metric & otros)                                    */
/* -------------------------------------------------------------------------- */

export interface MetricElement {
  id: string;
  code: string;
  name: string;
  type: string;
  locationPolygon: string | null;
  metadata: Record<string, unknown> | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetricPhase {
  id: string;
  code: string;
  name: string;
  serviceId: string;
  createdAt: string;
  updatedAt: string;
  variables?: MetricVariable[];
}

export interface MetricVariable {
  id: string;
  code: string;
  name: string;
  type: 'SCALAR' | 'FILE' | 'LIST';
  unit: string | null;
  phaseId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetricDataPoint {
  id: string;
  value: string;
  fileUrl: string | null;
  variableId: string;
  elementId: string | null;
  phaseId: string;
  createdById: string;
  createdAt: string;
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  variable?: MetricVariable;
  element?: MetricElement;
}

export function listMetricElements(projectId: string): Promise<MetricElement[]> {
  return request<MetricElement[]>(`/metrics/elements?projectId=${encodeURIComponent(projectId)}`);
}

/**
 * Grid de elevaciones (downsampled) del DEM real de una poza. Mismo shape que el
 * visor 3D consumía desde public/dem, ahora servido por el backend leyendo el
 * GeoTIFF desde R2.
 */
export interface DemGrid {
  code: string;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  minZ: number;
  maxZ: number;
  noData: number | null;
  elevations: number[];
}

/**
 * `GET /metrics/elements/code/:code/dem-grid` — grid de elevaciones del DEM más
 * reciente de la poza, con el gate `can_view` del proyecto. Sustituye la lectura
 * pública de public/dem/<code>.json por acceso autorizado.
 */
export function getDemGrid(code: string): Promise<DemGrid> {
  return request<DemGrid>(`/metrics/elements/code/${encodeURIComponent(code)}/dem-grid`);
}

export function listMetricPhases(serviceId: string): Promise<MetricPhase[]> {
  return request<MetricPhase[]>(`/metrics/phases?serviceId=${encodeURIComponent(serviceId)}`);
}

/**
 * `POST /metrics/phases` — crea una fase/sprint dentro de un servicio (A0). El
 * gate `can_submit_measurements` sobre el proyecto de la fase lo resuelve el
 * backend. Devuelve la fase creada (sin variables todavía; el DataSpec se fija
 * luego con {@link setPhaseDataSpec}).
 */
export function createMetricPhase(dto: {
  code: string;
  name: string;
  serviceId: string;
}): Promise<MetricPhase> {
  return request<MetricPhase>('/metrics/phases', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function listMetricVariables(phaseId: string): Promise<MetricVariable[]> {
  return request<MetricVariable[]>(`/metrics/variables?phaseId=${encodeURIComponent(phaseId)}`);
}

export function getMetricDataPoints(phaseId: string, elementId?: string): Promise<MetricDataPoint[]> {
  const query = elementId ? `?elementId=${encodeURIComponent(elementId)}` : '';
  return request<MetricDataPoint[]>(`/metrics/data/${encodeURIComponent(phaseId)}${query}`);
}export function submitMetricDataPoints(points: Array<{
  value: string;
  variableId: string;
  elementId: string;
  phaseId: string;
  taskId?: string;
}>): Promise<void> {
  return request<void>('/metrics/data', {
    method: 'POST',
    body: JSON.stringify({ points }),
  });
}

export function createMetricElement(dto: {
  code: string;
  name: string;
  type: string;
  locationPolygon: string | null;
  metadata: Record<string, unknown> | null;
  projectId: string;
}): Promise<MetricElement> {
  return request<MetricElement>('/metrics/elements', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function updateMetricElement(
  id: string,
  dto: {
    code: string;
    name: string;
    type: string;
    locationPolygon: string | null;
    metadata: Record<string, unknown> | null;
    projectId: string;
  },
): Promise<MetricElement> {
  return request<MetricElement>(`/metrics/elements/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

export function deleteMetricElement(id: string): Promise<void> {
  return request<void>(`/metrics/elements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Proyectos — jerarquía A0: Cliente → Faena → Proyecto → Trabajadores        */
/* -------------------------------------------------------------------------- */
/*
 * Capa 1 (Clientes), Capa 2 (Faenas), Capa 3 (Proyectos por faena) y Capa 4
 * (asignación de trabajadores). Los gates (`client:create`, `faena:create`,
 * `project:team:manage`) los resuelve el backend con OpenFGA; el front oculta
 * los botones de creación con `useHasPermission` (gating de UI). La LECTURA de
 * faenas es abierta; las mutaciones devuelven 403 si falta el gate.
 */

/* --- Capa 1: Clientes (GET /clients con métricas) --- */

/** `GET /clients` — catálogo de clientes con métricas de card (A0 Capa 1). */
export function listClients(): Promise<ClientView[]> {
  return request<ClientView[]>('/clients');
}

/** `POST /clients` — crea un cliente. Gate `client:create` (403 si falta). */
export function createClient(dto: CreateClientInput): Promise<ClientView> {
  return request<ClientView>('/clients', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/** `PATCH /clients/:id` — edita un cliente. Gate `client:create` (403 si falta). */
export function updateClient(id: string, dto: UpdateClientInput): Promise<ClientView> {
  return request<ClientView>(`/clients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/** `DELETE /clients/:id` — elimina un cliente. Gate `client:create` (403 si falta). */
export function deleteClient(id: string): Promise<{ success: true }> {
  return request<{ success: true }>(`/clients/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* --- Capa 2: Faenas (GET /clients/:id/faenas — lectura abierta) --- */

/** `GET /clients/:clientId/faenas` — faenas de un cliente con métricas (lectura abierta). */
export function listFaenas(clientId: string): Promise<FaenaView[]> {
  return request<FaenaView[]>(`/clients/${encodeURIComponent(clientId)}/faenas`);
}

/** `POST /clients/:clientId/faenas` — crea una faena. Gate `faena:create` (403 si falta). */
export function createFaena(clientId: string, dto: CreateFaenaInput): Promise<FaenaView> {
  return request<FaenaView>(`/clients/${encodeURIComponent(clientId)}/faenas`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/** `PATCH /faenas/:id` — edita una faena. Gate `faena:create` (403 si falta). */
export function updateFaena(id: string, dto: Partial<CreateFaenaInput>): Promise<FaenaView> {
  return request<FaenaView>(`/faenas/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/** `DELETE /faenas/:id` — elimina una faena. Gate `faena:create` (403 si falta). */
export function deleteFaena(id: string): Promise<void> {
  return request<void>(`/faenas/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* --- Capa 3: Proyectos por faena --- */
/*
 * La lista/creación de proyectos usan {@link listProjects}(faenaId) y
 * {@link createProject}(CreateProjectInput) definidas arriba (sección legacy,
 * ya extendidas para A0). {@link getProject} añade el detalle por id.
 */

/** `GET /projects/:id` — detalle de un proyecto. 404 si no existe. */
export function getProject(id: string): Promise<ProjectView> {
  return request<ProjectView>(`/projects/${encodeURIComponent(id)}`);
}

/**
 * `PATCH /projects/:id` — edita un proyecto. En este corte SOLO `name`/
 * `description` ({@link UpdateProjectInput}). Devuelve el proyecto actualizado.
 */
export function updateProject(id: string, dto: UpdateProjectInput): Promise<ProjectView> {
  return request<ProjectView>(`/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/** `DELETE /projects/:id` — elimina un proyecto. No devuelve cuerpo. */
export function deleteProject(id: string): Promise<void> {
  return request<void>(`/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * `GET /projects/eligible-admins` — usuarios elegibles como administrador de
 * proyecto (selector `projectAdminId` del wizard de creación, A0 Capa 3).
 */
export function listEligibleAdmins(): Promise<UserRef[]> {
  return request<UserRef[]>('/projects/eligible-admins');
}

/* --- Capa 4: Asignación de trabajadores (gate project:team:manage) --- */

/** `GET /projects/:projectId/assignments` — trabajadores asignados al proyecto. */
export function listAssignments(projectId: string): Promise<ProjectWorkerAssignmentView[]> {
  return request<ProjectWorkerAssignmentView[]>(
    `/projects/${encodeURIComponent(projectId)}/assignments`,
  );
}

/** `POST /projects/:projectId/assignments` — asigna un trabajador. Gate `project:team:manage`. */
export function createAssignment(
  projectId: string,
  dto: AssignWorkerInput,
): Promise<ProjectWorkerAssignmentView> {
  return request<ProjectWorkerAssignmentView>(
    `/projects/${encodeURIComponent(projectId)}/assignments`,
    { method: 'POST', body: JSON.stringify(dto) },
  );
}

/** `PATCH /projects/:projectId/assignments/:assignmentId` — edita una asignación. Gate `project:team:manage`. */
export function updateAssignment(
  projectId: string,
  assignmentId: string,
  dto: Partial<AssignWorkerInput>,
): Promise<ProjectWorkerAssignmentView> {
  return request<ProjectWorkerAssignmentView>(
    `/projects/${encodeURIComponent(projectId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'PATCH', body: JSON.stringify(dto) },
  );
}

/** `DELETE /projects/:projectId/assignments/:assignmentId` — quita una asignación. Gate `project:team:manage`. */
export function removeAssignment(projectId: string, assignmentId: string): Promise<void> {
  return request<void>(
    `/projects/${encodeURIComponent(projectId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'DELETE' },
  );
}

/* --- Datos esperados por fase / frecuencia de servicios --- */

/**
 * `PUT /metrics/phases/:phaseId/dataspec` — fija las variables tipadas esperadas
 * de una fase (editor de datos esperados, A0). Reemplaza el spec completo.
 */
export function setPhaseDataSpec(
  phaseId: string,
  dto: PhaseDataSpecInput,
): Promise<void> {
  return request<void>(`/metrics/phases/${encodeURIComponent(phaseId)}/dataspec`, {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

/**
 * `PATCH /projects/:projectId/services/:serviceId` — fija la frecuencia de un
 * servicio RUTINARIO (A0). Devuelve el servicio actualizado.
 */
export function setServiceFrequency(
  projectId: string,
  serviceId: string,
  dto: { frequency: ServiceFrequency },
): Promise<ServiceView> {
  return request<ServiceView>(
    `/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}`,
    { method: 'PATCH', body: JSON.stringify(dto) },
  );
}

