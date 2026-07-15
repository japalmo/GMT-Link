import { describe, it, expect, beforeAll, vi } from 'vitest';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';
import { hashPassword } from '../../src/common/password';

beforeAll(() => { process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min'; });

function makeController(
  user: {
    id: string;
    passwordHash: string | null;
    status?: string;
    tokenVersion?: number;
    failedLoginAttempts?: number;
    lockedUntil?: Date | null;
  } | null,
  // Valor que devuelve `user.update` (registerFailedLogin lee failedLoginAttempts
  // del incremento atómico para decidir el bloqueo). Default: contador bajo el tope.
  updateResult: { failedLoginAttempts?: number } = { failedLoginAttempts: 1 },
) {
  const findUnique = vi.fn().mockResolvedValue(user);
  const update = vi.fn().mockResolvedValue(updateResult);
  const prisma = { user: { findUnique, update } };
  return {
    ctrl: new AuthController(
      prisma as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    ),
    findUnique,
    update,
  };
}

describe('AuthController.login', () => {
  it('devuelve un token con credenciales válidas y resuelve por username', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl, findUnique } = makeController({ id: 'u1', passwordHash: hash, status: 'ACTIVE', tokenVersion: 0 });
    const res = await ctrl.login({ username: 'jperez', password: 'Secreta123' });
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(10);
    expect(findUnique).toHaveBeenCalledWith({
      where: { username: 'jperez' },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        tokenVersion: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });
  });
  it('permite loguear a un usuario PENDING_FIRST_LOGIN (no se bloquea el primer acceso)', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl } = makeController({ id: 'u1', passwordHash: hash, status: 'PENDING_FIRST_LOGIN' });
    const res = await ctrl.login({ username: 'jperez', password: 'Secreta123' });
    expect(typeof res.token).toBe('string');
  });
  it('401 si la contraseña es incorrecta', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl } = makeController({ id: 'u1', passwordHash: hash, status: 'ACTIVE' });
    await expect(ctrl.login({ username: 'jperez', password: 'mala' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('401 si el usuario no existe', async () => {
    const { ctrl } = makeController(null);
    await expect(ctrl.login({ username: 'nadie', password: 'lo-que-sea' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('401 con credenciales válidas si la cuenta está SUSPENDED (hallazgo A1)', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl } = makeController({ id: 'u1', passwordHash: hash, status: 'SUSPENDED' });
    await expect(
      ctrl.login({ username: 'jperez', password: 'Secreta123' }),
    ).rejects.toThrow(/suspendida/i);
    await expect(
      ctrl.login({ username: 'jperez', password: 'Secreta123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthController.login · lockout por cuenta (#67)', () => {
  it('cuenta bloqueada pero clave CORRECTA → ingresa igual y limpia el bloqueo (no DoS al dueño)', async () => {
    const hash = await hashPassword('Secreta123');
    const future = new Date(Date.now() + 10 * 60_000);
    const { ctrl, update } = makeController({
      id: 'u1',
      passwordHash: hash,
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: future,
    });
    // El lockout solo frena intentos ERRÓNEOS: quien sabe su clave entra igual.
    const res = await ctrl.login({ username: 'jperez', password: 'Secreta123' });
    expect(typeof res.token).toBe('string');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('cuenta bloqueada + clave INCORRECTA → 429 y no cuenta el intento', async () => {
    const hash = await hashPassword('Secreta123');
    const future = new Date(Date.now() + 10 * 60_000);
    const { ctrl, update } = makeController({
      id: 'u1',
      passwordHash: hash,
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: future,
    });
    const err = await ctrl.login({ username: 'jperez', password: 'mala' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    // assertNotLockedOut lanza ANTES de registerFailedLogin: no hay update.
    expect(update).not.toHaveBeenCalled();
  });

  it('clave incorrecta en cuenta existente no bloqueada → incrementa el contador atómicamente', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl, update } = makeController(
      { id: 'u1', passwordHash: hash, status: 'ACTIVE', failedLoginAttempts: 2, lockedUntil: null },
      { failedLoginAttempts: 3 }, // el incremento atómico devuelve 3 (bajo el tope)
    );
    await expect(
      ctrl.login({ username: 'jperez', password: 'mala' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toEqual({
      where: { id: 'u1' },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
  });

  it('cuando el incremento atómico llega al tope (10) → bloquea la cuenta (segundo update con lockedUntil)', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl, update } = makeController(
      { id: 'u1', passwordHash: hash, status: 'ACTIVE', failedLoginAttempts: 9, lockedUntil: null },
      { failedLoginAttempts: 10 }, // el incremento atómico devuelve 10 (tope)
    );
    await expect(
      ctrl.login({ username: 'jperez', password: 'mala' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).toHaveBeenCalledTimes(2);
    const lockCall = update.mock.calls[1]?.[0] as {
      data: { failedLoginAttempts: number; lockedUntil: Date };
    };
    expect(lockCall.data.failedLoginAttempts).toBe(0);
    expect(lockCall.data.lockedUntil).toBeInstanceOf(Date);
    expect(lockCall.data.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('username inexistente → 401 genérico y NO intenta contar intentos (no hay fila)', async () => {
    const { ctrl, update } = makeController(null);
    await expect(
      ctrl.login({ username: 'nadie', password: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
  });

  it('ingreso correcto con intentos previos → limpia contador y bloqueo', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl, update } = makeController({
      id: 'u1',
      passwordHash: hash,
      status: 'ACTIVE',
      failedLoginAttempts: 4,
      lockedUntil: null,
    });
    await ctrl.login({ username: 'jperez', password: 'Secreta123' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('ingreso correcto SIN intentos previos → no toca la fila (no update)', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl, update } = makeController({
      id: 'u1',
      passwordHash: hash,
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await ctrl.login({ username: 'jperez', password: 'Secreta123' });
    expect(update).not.toHaveBeenCalled();
  });
});
