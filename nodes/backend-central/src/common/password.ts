import bcrypt from 'bcryptjs';

/** Coste de bcrypt. 12 ≈ ~250ms/hash: buen balance seguridad/latencia. */
const SALT_ROUNDS = 12;

/**
 * Hash bcrypt (coste 12) de un valor aleatorio descartado: no corresponde a
 * ninguna clave. El login compara contra él cuando el usuario no existe o no tiene
 * clave, para que esa respuesta tarde lo mismo que una con usuario real y el
 * tiempo no delate qué usernames existen.
 */
export const DUMMY_BCRYPT_HASH = '$2b$12$1ENdfNJe4AfU9J1fgj.ZQepC1ns9dw2jJi5gvhP2rfF9Eai6iU6ly';

/** Hashea una contraseña en claro. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Compara una contraseña en claro contra su hash bcrypt. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
