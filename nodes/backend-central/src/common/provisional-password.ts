import { randomInt } from 'node:crypto';

/**
 * Generador de claves provisorias fuertes (§1.1).
 *
 * Decisión cerrada (CLAUDE.md §9): la provisión de usuarios NO envía email; la
 * clave se retorna en la respuesta para que el admin la comparta manualmente.
 * Por eso debe ser legible (sin libs externas) pero fuerte:
 *  - longitud configurable, mínimo 12 caracteres;
 *  - garantiza al menos un carácter de cada clase (minúscula, mayúscula,
 *    dígito, símbolo) para satisfacer la política de Firebase / cualquier IdP;
 *  - usa `crypto.randomInt` (CSPRNG) — nunca `Math.random` para secretos;
 *  - se omiten caracteres ambiguos (O/0, l/1/I) para reducir errores al copiar.
 */
const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // sin l, o
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I, O
const DIGITS = '23456789'; // sin 0, 1
const SYMBOLS = '!@#$%*?-_';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const MIN_LENGTH = 12;

/** Índice aleatorio criptográfico dentro de un alfabeto no vacío. */
function pick(alphabet: string): string {
  // randomInt(max) ∈ [0, max); alphabet.length ≥ 1 por construcción.
  return alphabet[randomInt(alphabet.length)] as string;
}

/**
 * Devuelve una clave provisoria fuerte de al menos `length` caracteres
 * (clamp a MIN_LENGTH). Mezcla el resultado con Fisher–Yates sobre CSPRNG.
 */
export function generateProvisionalPassword(length: number = MIN_LENGTH): string {
  const target = Math.max(length, MIN_LENGTH);

  // Una de cada clase para cumplir políticas de complejidad.
  const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];

  const chars: string[] = [...required];
  while (chars.length < target) {
    chars.push(pick(ALL));
  }

  // Fisher–Yates con randomInt para no dejar las clases requeridas al frente.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = chars[i] as string;
    chars[i] = chars[j] as string;
    chars[j] = tmp;
  }

  return chars.join('');
}
