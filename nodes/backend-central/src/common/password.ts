import bcrypt from 'bcryptjs';

/** Coste de bcrypt. 12 ≈ ~250ms/hash: buen balance seguridad/latencia. */
const SALT_ROUNDS = 12;

/** Hashea una contraseña en claro. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Compara una contraseña en claro contra su hash bcrypt. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
