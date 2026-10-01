/**
 * Validación de variables de entorno críticas al arranque (fail-fast).
 *
 * Se invoca al inicio de bootstrap() en main.ts, después de que dotenv pobló
 * process.env y antes de instanciar la app Nest, de modo que un secreto débil
 * o ausente aborta el proceso ANTES de aceptar tráfico.
 */

import { isR2Configured } from './storage/r2-storage.service';

/** Longitud mínima recomendada para una clave HMAC-SHA256 (32 bytes = 256 bits). */
const MIN_SECRET_BYTES = 32;

/**
 * Verifica que AUTH_JWT_SECRET exista y tenga al menos 32 bytes (UTF-8).
 * Lanza Error (que aborta el boot) si no cumple. Mide BYTES, no caracteres,
 * porque la fortaleza del HMAC depende de los bytes de la clave.
 */
export function validateAuthJwtSecret(): void {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'AUTH_JWT_SECRET no está configurado. Define un secreto de al menos 32 bytes antes de arrancar.',
    );
  }
  const bytes = Buffer.byteLength(secret.trim(), 'utf8');
  if (bytes < MIN_SECRET_BYTES) {
    throw new Error(
      `AUTH_JWT_SECRET es demasiado corto (${bytes} bytes útiles). Se requieren al menos ${MIN_SECRET_BYTES} bytes para HS256.`,
    );
  }
}

/**
 * En producción exige R2 completo (las 5 variables `R2_*`). Sin esto,
 * `StorageModule` caería en silencio al storage local: disco efímero del
 * contenedor (los archivos se pierden en cada deploy) y `/files` montado sin
 * sesión. Fuera de producción no exige nada: el storage local es el de desarrollo.
 */
export function validateStorageConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && !isR2Configured(env)) {
    throw new Error(
      'R2_* incompleto: producción no puede usar storage local ni exponer /files. ' +
        'Define R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET y R2_ENDPOINT.',
    );
  }
}
