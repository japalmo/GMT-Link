import { StorageService } from './storage.service';
import { freshFileUrl } from './fresh-file-url';

/**
 * Resuelve la URL de descarga/visualización FRESCA de un archivo a partir del
 * valor persistido en BD (patrón Fase 1B, presign-al-leer). Variante NO nula de
 * `freshFileUrl` para los endpoints `GET …/file-url`, cuyos campos son NOT NULL:
 *
 *  - CLAVE de storage + R2 activo → URL prefirmada fresca (TTL configurado);
 *  - CLAVE de storage + backend local (dev) → URL del `FilesController`;
 *  - URL absoluta legada del PROPIO bucket R2 → se rescata la clave del path y
 *    se re-presigna (revive enlaces guardados antes del fix, ya vencidos);
 *  - cualquier otra URL absoluta (`http(s)://…`) → passthrough tal cual.
 *
 * Los registros nuevos SIEMPRE guardan la clave (`saved.key`) y piden la URL
 * por endpoint al momento de leer, nunca navegan el valor crudo.
 */
export async function resolveFreshFileUrl(
  storage: StorageService,
  stored: string,
): Promise<string> {
  return (await freshFileUrl(storage, stored)) ?? stored;
}
