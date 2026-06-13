import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { SessionMiddleware } from '../../src/auth/session.middleware';
import type { FirebaseService } from '../../src/auth/firebase.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import '../../src/auth/auth-request.types';

/** Forma mínima del User que el middleware consume de Prisma. */
interface UserRow {
  id: string;
  email: string;
}

interface Mocks {
  firebase: FirebaseService;
  prisma: PrismaService;
  verifyIdToken: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
}

function buildMocks(options: {
  decoded?: Partial<DecodedIdToken>;
  verifyThrows?: boolean;
  user?: UserRow | null;
}): Mocks {
  const verifyIdToken = vi.fn((token: string): Promise<DecodedIdToken> => {
    void token;
    if (options.verifyThrows) {
      return Promise.reject(new Error('token inválido'));
    }
    const base: DecodedIdToken = {
      uid: 'fb-uid',
      aud: 'demo',
      auth_time: 0,
      exp: 0,
      firebase: { identities: {}, sign_in_provider: 'password' },
      iat: 0,
      iss: 'demo',
      sub: 'fb-uid',
      ...options.decoded,
    } as DecodedIdToken;
    return Promise.resolve(base);
  });

  const findUnique = vi.fn((): Promise<UserRow | null> => {
    return Promise.resolve(options.user ?? null);
  });

  const firebase = { verifyIdToken } as unknown as FirebaseService;
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  return { firebase, prisma, verifyIdToken, findUnique };
}

function buildReq(authorization?: string): Request {
  const headers: Record<string, string | undefined> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return {
    header: (name: string): string | undefined => headers[name.toLowerCase()],
  } as unknown as Request;
}

const RES = {} as Response;

describe('SessionMiddleware', () => {
  it('setea authUser y firebaseUid con token válido y usuario existente', async () => {
    const { firebase, prisma, findUnique } = buildMocks({
      decoded: { uid: 'fb-uid', email: 'colaborador@gtm.cl', email_verified: true },
      user: { id: 'u1', email: 'colaborador@gtm.cl' },
    });
    const mw = new SessionMiddleware(firebase, prisma);
    const req = buildReq('Bearer good-token');
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'colaborador@gtm.cl' } });
    expect(req.authUser).toEqual({ id: 'u1', email: 'colaborador@gtm.cl' });
    expect(req.firebaseUid).toBe('fb-uid');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('no setea authUser cuando el token es inválido', async () => {
    const { firebase, prisma, findUnique } = buildMocks({ verifyThrows: true });
    const mw = new SessionMiddleware(firebase, prisma);
    const req = buildReq('Bearer bad-token');
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(req.authUser).toBeUndefined();
    expect(req.firebaseUid).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('no setea authUser cuando falta el header Authorization', async () => {
    const { firebase, prisma, verifyIdToken } = buildMocks({});
    const mw = new SessionMiddleware(firebase, prisma);
    const req = buildReq();
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(req.authUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('no setea authUser cuando el email no está verificado (§3 endurecimiento)', async () => {
    const { firebase, prisma, findUnique } = buildMocks({
      decoded: { email: 'colaborador@gtm.cl', email_verified: false },
      user: { id: 'u1', email: 'colaborador@gtm.cl' },
    });
    const mw = new SessionMiddleware(firebase, prisma);
    const req = buildReq('Bearer token-sin-verificar');
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(findUnique).not.toHaveBeenCalled();
    expect(req.authUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('no setea authUser cuando no existe User espejo en Postgres', async () => {
    const { firebase, prisma } = buildMocks({
      decoded: { email: 'fantasma@gtm.cl', email_verified: true },
      user: null,
    });
    const mw = new SessionMiddleware(firebase, prisma);
    const req = buildReq('Bearer good-token');
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(req.authUser).toBeUndefined();
    expect(req.firebaseUid).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
