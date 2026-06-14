import { auth } from '@/lib/firebase';
import type { AuthedUser } from '@/types/auth';
import type { RoleKey, UserStatus } from '@gtm-link/shared-types';

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
