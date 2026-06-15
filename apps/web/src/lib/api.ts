import { auth } from '@/lib/firebase';
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
import type { NotificationView } from '@/types/notifications';
import type {
  PermissionRequestAdminView,
  PermissionRequestView,
  UpdateSettingsInput,
  UserSettings,
} from '@/types/settings';
import type {
  DirectoryEntry,
  DirectoryEntryExtended,
  ProfileMe,
  RoleKey,
  UpdateProfileInput,
  UserStatus,
} from '@gtm-link/shared-types';

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
 * `fetch` tipado contra la API. Adjunta el ID token de Firebase del usuario
 * actual en `Authorization: Bearer …` cuando hay sesión. Lanza `ApiError` en
 * respuestas no-2xx con el mensaje más útil disponible.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  const token = await auth.currentUser?.getIdToken();
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
 * `boundary` correcto a partir del `FormData`. Adjunta el ID token de Firebase
 * igual que `request` y comparte el manejo de errores (`ApiError`).
 */
async function uploadRequest<T>(
  path: string,
  formData: FormData,
  method = 'POST',
): Promise<T> {
  const headers = new Headers();
  const token = await auth.currentUser?.getIdToken();
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
export function getMe(): Promise<AuthedUser> {
  return request<AuthedUser>('/auth/me');
}

/**
 * `POST /auth/first-login/complete` — fija la contraseña y activa la cuenta.
 * No devuelve datos de interés para la UI más allá del éxito.
 */
export async function completeFirstLogin(newPassword: string): Promise<void> {
  await request<{ status: string }>('/auth/first-login/complete', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
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

/** Respuesta de asignar/quitar un rol: el id y los roleKeys resultantes. */
export interface UserRolesResponse {
  id: string;
  roleKeys: RoleKey[];
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

/** `POST /users/:id/roles` — asigna un rol. 409 si ya lo tiene. */
export function assignUserRole(id: string, roleKey: RoleKey): Promise<UserRolesResponse> {
  return request<UserRolesResponse>(`/users/${encodeURIComponent(id)}/roles`, {
    method: 'POST',
    body: JSON.stringify({ roleKey }),
  });
}

/** `DELETE /users/:id/roles/:roleKey` — quita un rol. 404 si no lo tiene. */
export function removeUserRole(id: string, roleKey: RoleKey): Promise<UserRolesResponse> {
  return request<UserRolesResponse>(
    `/users/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleKey)}`,
    { method: 'DELETE' },
  );
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
