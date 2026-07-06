import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorageService,
  ThrottlerException,
} from '@nestjs/throttler';
import { AuthController } from '../../src/auth/auth.controller';

/**
 * Verifica que el rate-limit por IP declarado con @Throttle sobre
 * AuthController.login (5 req / 60 s) produce ThrottlerException (HTTP 429)
 * en la 6.ª petición desde la misma IP.
 */

const LIMIT = 5;
const GLOBAL_LIMIT = 120;
const TTL_MS = 60_000;

function makeContext(ip: string): ExecutionContext {
  const req = { ip, headers: {}, method: 'POST', url: '/auth/login' };
  const res = { header: () => undefined };
  return {
    getClass: () => AuthController,
    getHandler: () => AuthController.prototype.login,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

async function makeGuard(): Promise<ThrottlerGuard> {
  const options: ThrottlerModuleOptions = [{ name: 'default', ttl: TTL_MS, limit: GLOBAL_LIMIT }];
  const storage = new ThrottlerStorageService();
  const reflector = new Reflector();
  const guard = new ThrottlerGuard(options, storage, reflector);
  // onModuleInit puebla this.throttlers y los defaults internos del guard.
  await guard.onModuleInit();
  return guard;
}

describe('Rate limit de POST /auth/login', () => {
  let guard: ThrottlerGuard;
  beforeEach(async () => {
    guard = await makeGuard();
  });

  it('permite las primeras 5 peticiones y bloquea la 6.ª con ThrottlerException (429)', async () => {
    const ctx = makeContext('203.0.113.7');
    for (let i = 0; i < LIMIT; i++) {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('cuenta el límite por IP: otra IP no queda bloqueada', async () => {
    const ctxA = makeContext('203.0.113.7');
    for (let i = 0; i < LIMIT; i++) {
      await guard.canActivate(ctxA);
    }
    await expect(guard.canActivate(ctxA)).rejects.toBeInstanceOf(ThrottlerException);
    const ctxB = makeContext('198.51.100.9');
    await expect(guard.canActivate(ctxB)).resolves.toBe(true);
  });
});
