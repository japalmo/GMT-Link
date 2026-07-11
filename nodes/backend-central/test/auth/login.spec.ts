import { describe, it, expect, beforeAll, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';
import { hashPassword } from '../../src/common/password';

beforeAll(() => { process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min'; });

function makeController(user: { id: string; passwordHash: string | null } | null) {
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
  return new AuthController(prisma as never, undefined as never, undefined as never, undefined as never);
}

describe('AuthController.login', () => {
  it('devuelve un token con credenciales válidas', async () => {
    const hash = await hashPassword('Secreta123');
    const ctrl = makeController({ id: 'u1', passwordHash: hash });
    const res = await ctrl.login({ email: 'a@b.cl', password: 'Secreta123' });
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(10);
  });
  it('401 si la contraseña es incorrecta', async () => {
    const hash = await hashPassword('Secreta123');
    const ctrl = makeController({ id: 'u1', passwordHash: hash });
    await expect(ctrl.login({ email: 'a@b.cl', password: 'mala' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('401 si el usuario no existe', async () => {
    const ctrl = makeController(null);
    await expect(ctrl.login({ email: 'x@y.cl', password: 'lo-que-sea' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
