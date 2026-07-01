import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/common/password';

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
