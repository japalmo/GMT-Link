import { R2StorageService } from './r2-storage.service';
import type { StorageService } from './storage.service';

/**
 * ¿El valor persistido es una URL absoluta (legada o externa) y no una clave de
 * storage? Los campos de archivo migrados guardan la CLAVE estable (ej.
 * `documents/uuid-cedula.pdf`); las filas anteriores al fix guardan URLs
 * absolutas (locales `/files/…`, firmadas de R2 o externas, ej. avatar).
 */
export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * ¿La URL apunta al objeto identificado por `key`? Compara el final del path
 * (decodificado) con `/<key>`: cubre la URL local del FilesController
 * (`…/files/<key>`) y las firmadas de R2 (`…/<bucket>/<key>?X-Amz-…`). Se usa
 * para detectar el ECO de una URL fresca que el cliente devuelve tal cual
 * (ej. el form de perfil re-envía el `avatarUrl` que recibió del GET).
 */
export function urlReferencesKey(url: string, key: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = parsed.pathname;
  }
  return pathname.endsWith(`/${key}`);
}

/**
 * Resuelve el valor persistido de un campo de archivo a una URL de descarga
 * FRESCA (fix R2: las URLs firmadas caducan en 1 h, así que se persiste la
 * CLAVE y se presigna AL LEER):
 *
 *  - `null`/vacío → `null` (sin archivo);
 *  - CLAVE + R2 → URL firmada fresca (`createPresignedGetUrl`);
 *  - CLAVE + local (dev) → URL del `FilesController` (`/files/<key>`);
 *  - URL absoluta legada del PROPIO bucket R2 → se RESCATA la clave del path y
 *    se re-presigna (revive los enlaces persistidos antes del fix, ya vencidos);
 *  - cualquier otra URL absoluta (local legada, externa) → passthrough tal cual.
 */
export async function freshFileUrl(
  storage: StorageService,
  stored: string | null | undefined,
): Promise<string | null> {
  if (stored === null || stored === undefined || stored.length === 0) {
    return null;
  }

  if (isAbsoluteUrl(stored)) {
    if (storage instanceof R2StorageService) {
      const rescuedKey = storage.extractKeyFromUrl(stored);
      if (rescuedKey !== null) {
        return storage.createPresignedGetUrl(rescuedKey);
      }
    }
    return stored;
  }

  if (storage instanceof R2StorageService) {
    return storage.createPresignedGetUrl(stored);
  }

  // Dev local: el FilesController sirve /files/<key>.
  const baseUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3001';
  return `${baseUrl}/files/${stored}`;
}
