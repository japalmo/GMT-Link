/**
 * Validación de variables de entorno críticas al arranque (fail-fast).
 *
 * Se invoca al inicio de bootstrap() en main.ts, después de que dotenv pobló
 * process.env y antes de instanciar la app Nest, de modo que un secreto débil
 * o ausente aborta el proceso ANTES de aceptar tráfico.
 */

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
