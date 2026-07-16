import { createHash } from 'crypto';

/**
 * Hash de contenido para firma verificada (#68). El hash SELLA exactamente lo que
 * se firma: si el contenido cambia entre pedir la firma y enviarla, el hash no
 * coincide y la firma se rechaza (no se puede firmar A y enviar B).
 *
 * Se serializa de forma CANÓNICA (claves ordenadas recursivamente) para que el
 * mismo contenido produzca siempre el mismo hash, independiente del orden de las
 * claves en el JSON de entrada.
 */

/** Ordena las claves de objetos recursivamente para una serialización estable. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Calcula el hash (sha256, base64url) del payload firmado. Se usa como el "challenge"
 * de WebAuthn (la firma lo cubre criptográficamente) y como `contextHash` de la
 * prueba, tanto en el camino biométrico como en el de OTP.
 */
export function computeContentHash(payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return createHash('sha256').update(canonical).digest('base64url');
}
