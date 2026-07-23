import { StorageService } from './storage.service';
import { R2StorageService } from './r2-storage.service';

/**
 * Resuelve la URL de descarga/visualización FRESCA de un archivo a partir del
 * valor persistido en BD (patrón Fase 1B, presign-al-leer):
 *
 *  - URL absoluta legada (`http(s)://…`) → passthrough tal cual (registros
 *    anteriores al cambio que guardaban `saved.url`; con R2 pueden estar ya
 *    vencidas, pero no hay clave extraíble para re-firmarlas);
 *  - CLAVE de storage + R2 activo → URL prefirmada fresca (TTL configurado);
 *  - CLAVE de storage + backend local (dev) → URL del `FilesController`.
 *
 * Los registros nuevos SIEMPRE guardan la clave (`saved.key`) y piden la URL
 * por endpoint al momento de leer, nunca navegan el valor crudo.
 */
export async function resolveFreshFileUrl(
  storage: StorageService,
  stored: string,
): Promise<string> {
  if (/^https?:\/\//i.test(stored)) {
    return stored;
  }
  if (storage instanceof R2StorageService) {
    return storage.createPresignedGetUrl(stored);
  }
  const baseUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3001';
  return `${baseUrl}/files/${stored}`;
}
