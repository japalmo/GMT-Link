import bcrypt from 'bcryptjs';
import { describe, it, expect } from 'vitest';
import { DUMMY_BCRYPT_HASH, hashPassword, verifyPassword } from '../../src/common/password';

describe('password helper', () => {
  it('hashea y verifica la misma contraseña', async () => {
    const hash = await hashPassword('Secreta123');
    expect(hash).not.toBe('Secreta123');
    expect(await verifyPassword('Secreta123', hash)).toBe(true);
  });
  it('rechaza una contraseña distinta', async () => {
    const hash = await hashPassword('Secreta123');
    expect(await verifyPassword('otra', hash)).toBe(false);
  });
});

describe('DUMMY_BCRYPT_HASH', () => {
  it('es un hash bcrypt válido de coste 12 (mismo costo que un usuario real)', () => {
    expect(bcrypt.getRounds(DUMMY_BCRYPT_HASH)).toBe(12);
  });

  it('no acepta claves triviales', async () => {
    for (const clave of ['', 'password', '123456', 'admin']) {
      await expect(verifyPassword(clave, DUMMY_BCRYPT_HASH)).resolves.toBe(false);
    }
  });
});
