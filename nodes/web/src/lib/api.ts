import { getToken } from '@/lib/auth-token';
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
  LiquidationView,
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
  PermissionCatalogGroup,
  ProfileMe,
  RoleDetail,
  RoleKey,
  UpdateProfileInput,
  UpdateRoleInput,
  UserMembership,
  UserStatus,
} from '@gmt-platform/contracts';

// Re-export para consumidores del front (enmienda A15: los tipos viven en
// @gmt-platform/contracts; api.ts solo los re-exporta para no duplicar imports).
export type { AssignRoleInput, CloneRoleResponse, UserMembership } from '@gmt-platform/contracts';
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
  ProjectWorkerAssignmentView,
  AssignWorkerInput,
  PhaseDataSpecInput,
  ServiceFrequency,
  UserRef,
} from '@/types/projects';
import type {
  AssetView,
  AssetPublicView,
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
  return (await res.json()) as T;
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
  return { ...me, canManageRoles: me.canManageRoles ?? false };
}

/** `POST /auth/login` — valida credenciales y devuelve nuestro JWT. */
export function login(email: string, password: string): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
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
  email: string;
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
  status: UserStatus;
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

/** `GET /users?search=` — directorio de usuarios. Orden createdAt desc. */
export function listUsers(search?: string): Promise<UserListItem[]> {
  const query = search && search.trim().length > 0
    ? `?search=${encodeURIComponent(search.trim())}`
    : '';
  return request<UserListItem[]>(`/users${query}`);
}

/** `GET /users/:id` — detalle de un usuario. 404 si no existe. */
export function getUser(id: string): Promise<UserListItem> {
  return request<UserListItem>(`/users/${encodeURIComponent(id)}`);
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
 * `POST /profile/change-password` — fija una nueva contraseña (mín. 8). No
 * devuelve datos de interés más allá del éxito. La clave nunca se registra.
 */
export async function changePassword(newPassword: string): Promise<void> {
  await request<{ ok: true }>('/profile/change-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
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

/** `POST /reimbursements` — crea un reembolso propio (PENDIENTE). */
export function createReimbursement(
  input: CreateReimbursementInput,
): Promise<ReimbursementView> {
  return request<ReimbursementView>('/reimbursements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `POST /reimbursements/import` — importa un lote de reembolsos propios (PENDIENTE). */
export function importReimbursements(
  items: CreateReimbursementInput[],
): Promise<ReimbursementView[]> {
  return request<ReimbursementView[]>('/reimbursements/import', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

/** `GET /reimbursements/me?status=` — reembolsos propios. Filtro de estado opcional. */
export function listMyReimbursements(
  status?: FinanceStatus,
): Promise<ReimbursementView[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<ReimbursementView[]>(`/reimbursements/me${query}`);
}

/**
 * `GET /reimbursements?status=&userId=` — TODOS los reembolsos (gestor). Devuelve
 * 403 si no se tiene `can_manage_finance` (el llamador lo trata como "no gestor"
 * sin romper la UI). Las filas incluyen `requester`.
 */
export function listAllReimbursements(filters: {
  status?: FinanceStatus;
  userId?: string;
}): Promise<ReimbursementView[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  const query = params.toString();
  return request<ReimbursementView[]>(`/reimbursements${query ? `?${query}` : ''}`);
}

/** `GET /reimbursements/:id` — detalle. Lo ve el dueño O un gestor. 404 si no. */
export function getReimbursement(id: string): Promise<ReimbursementView> {
  return request<ReimbursementView>(`/reimbursements/${encodeURIComponent(id)}`);
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
 * `POST /reimbursements/print` — genera en el SERVIDOR un PDF con las boletas de
 * los reembolsos indicados, en grilla de `perPage` (2/4/6) por página (§6-3.2).
 * Solo gestores (403 si no). Devuelve el PDF como `Blob` para descargar.
 */
export async function downloadReimbursementsPdf(
  ids: string[],
  perPage: 2 | 4 | 6,
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
      body: JSON.stringify({ ids, perPage }),
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

/* --- Horas extra --- */

/** `POST /overtime` — crea una solicitud de horas extra propia (PENDIENTE). */
export function createOvertime(input: CreateOvertimeInput): Promise<OvertimeView> {
  return request<OvertimeView>('/overtime', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `GET /overtime/me?status=` — solicitudes propias. Filtro de estado opcional. */
export function listMyOvertime(status?: FinanceStatus): Promise<OvertimeView[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<OvertimeView[]>(`/overtime/me${query}`);
}

/**
 * `GET /overtime?status=&userId=` — TODAS las solicitudes (gestor). Devuelve 403
 * si no se tiene `can_manage_finance` (el llamador lo trata como "no gestor" sin
 * romper la UI). Las filas incluyen `requester`.
 */
export function listAllOvertime(filters: {
  status?: FinanceStatus;
  userId?: string;
}): Promise<OvertimeView[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  const query = params.toString();
  return request<OvertimeView[]>(`/overtime${query ? `?${query}` : ''}`);
}

/** `GET /overtime/:id` — detalle. Lo ve el dueño O un gestor. 404 si no. */
export function getOvertime(id: string): Promise<OvertimeView> {
  return request<OvertimeView>(`/overtime/${encodeURIComponent(id)}`);
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

/* --- Liquidaciones --- */

/** `GET /liquidations/me` — obtiene las liquidaciones propias del colaborador. */
export function listMyLiquidations(): Promise<LiquidationView[]> {
  return request<LiquidationView[]>('/liquidations/me');
}

/** `GET /liquidations` — obtiene todas las liquidaciones del sistema (gestor). */
export function listAllLiquidations(): Promise<LiquidationView[]> {
  return request<LiquidationView[]>('/liquidations');
}

/** `POST /liquidations` — sube una liquidación de sueldo PDF (gestor). */
export function uploadLiquidation(
  userId: string,
  period: string,
  file: File,
): Promise<LiquidationView> {
  const formData = new FormData();
  formData.append('userId', userId);
  formData.append('period', period);
  formData.append('file', file);
  return uploadRequest<LiquidationView>('/liquidations', formData);
}

/** `DELETE /liquidations/:id` — elimina una liquidación (gestor). */
export function deleteLiquidation(id: string): Promise<void> {
  return request<void>(`/liquidations/${encodeURIComponent(id)}`, {
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

export function createService(
  projectId: string,
  dto: { code: string; name: string; docCodingConfig: Record<string, unknown> },
): Promise<ServiceView> {
  return request<ServiceView>(`/projects/${encodeURIComponent(projectId)}/services`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
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

export function listAssets(filters: {
  type?: AssetType;
  status?: AssetStatus;
  projectId?: string;
} = {}): Promise<AssetView[]> {
  const query = new URLSearchParams();
  if (filters.type) query.append('type', filters.type);
  if (filters.status) query.append('status', filters.status);
  if (filters.projectId) query.append('projectId', filters.projectId);
  const qs = query.toString();
  return request<AssetView[]>(`/assets${qs ? `?${qs}` : ''}`);
}

export function createAsset(dto: CreateAssetInput): Promise<AssetView> {
  return request<AssetView>('/assets', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function getAsset(id: string): Promise<AssetView> {
  return request<AssetView>(`/assets/${encodeURIComponent(id)}`);
}

export function getPublicAsset(code: string): Promise<AssetPublicView> {
  return request<AssetPublicView>(`/assets/public/${encodeURIComponent(code)}`);
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

export function getMetricElementByCode(code: string): Promise<MetricElement> {
  return request<MetricElement>(`/metrics/elements/code/${encodeURIComponent(code)}`);
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
 * los botones de creación con `useHasRole` (gating de demo). La LECTURA de
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

/** `GET /clients/:id` — detalle de un cliente. 404 si no existe. */
export function getClient(id: string): Promise<ClientView> {
  return request<ClientView>(`/clients/${encodeURIComponent(id)}`);
}

/** `PATCH /clients/:id` — edita un cliente. Gate `client:create` (403 si falta). */
export function updateClient(id: string, dto: UpdateClientInput): Promise<ClientView> {
  return request<ClientView>(`/clients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
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

/** `GET /faenas/:id` — detalle de una faena. 404 si no existe. */
export function getFaena(id: string): Promise<FaenaView> {
  return request<FaenaView>(`/faenas/${encodeURIComponent(id)}`);
}

/** `PATCH /faenas/:id` — edita una faena. Gate `faena:create` (403 si falta). */
export function updateFaena(id: string, dto: Partial<CreateFaenaInput>): Promise<FaenaView> {
  return request<FaenaView>(`/faenas/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
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

