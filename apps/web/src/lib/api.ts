import { auth } from '@/lib/firebase';
import type { AuthedUser } from '@/types/auth';

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
