import 'reflect-metadata';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { SessionMiddleware } from '../../src/auth/session.middleware';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { signToken } from '../../src/common/jwt';
import '../../src/auth/auth-request.types';

/** Forma mínima del User que el middleware consume de Prisma. */
interface UserRow {
  id: string;
  email: string;
  status: string;
  tokenVersion: number;
}

interface Mocks {
  prisma: PrismaService;
  findUnique: ReturnType<typeof vi.fn>;
}

function buildMocks(user: UserRow | null): Mocks {
  const findUnique = vi.fn((): Promise<UserRow | null> => Promise.resolve(user));
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  return { prisma, findUnique };
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
  beforeAll(() => {
    process.env.AUTH_JWT_SECRET = 'test-secret-para-session-middleware';
  });

  it('no setea authUser cuando falta el header Authorization', async () => {
    const { prisma, findUnique } = buildMocks(null);
    const mw = new SessionMiddleware(prisma);
    const req = buildReq();
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(findUnique).not.toHaveBeenCalled();
    expect(req.authUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('setea authUser con un JWT propio válido y usuario existente', async () => {
    const { prisma, findUnique } = buildMocks({
      id: 'u1',
      email: 'colaborador@gmt.cl',
      status: 'ACTIVE',
      tokenVersion: 0,
    });
    const mw = new SessionMiddleware(prisma);
    const token = signToken('u1', 0);
    const req = buildReq(`Bearer ${token}`);
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, email: true, status: true, tokenVersion: true },
    });
    expect(req.authUser).toEqual({ id: 'u1', email: 'colaborador@gmt.cl' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('NO setea authUser cuando el usuario está SUSPENDED (corta tokens ya emitidos, hallazgo A1)', async () => {
    const { prisma, findUnique } = buildMocks({
      id: 'u1',
      email: 'colaborador@gmt.cl',
      status: 'SUSPENDED',
      tokenVersion: 0,
    });
    const mw = new SessionMiddleware(prisma);
    const token = signToken('u1', 0);
    const req = buildReq(`Bearer ${token}`);
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(req.authUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('NO setea authUser cuando el tokenVersion del JWT quedó desfasado (sesión revocada, A3)', async () => {
    const { prisma, findUnique } = buildMocks({
      id: 'u1',
      email: 'colaborador@gmt.cl',
      status: 'ACTIVE',
      tokenVersion: 1, // el usuario ya rotó su época; el token viejo trae 0
    });
    const mw = new SessionMiddleware(prisma);
    const token = signToken('u1', 0);
    const req = buildReq(`Bearer ${token}`);
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(req.authUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('no setea authUser cuando el token es inválido', async () => {
    const { prisma, findUnique } = buildMocks({
      id: 'u1',
      email: 'colaborador@gmt.cl',
      status: 'ACTIVE',
      tokenVersion: 0,
    });
    const mw = new SessionMiddleware(prisma);
    const req = buildReq('Bearer token-invalido');
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(findUnique).not.toHaveBeenCalled();
    expect(req.authUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('no setea authUser cuando no existe User en Postgres', async () => {
    const { prisma } = buildMocks(null);
    const mw = new SessionMiddleware(prisma);
    const token = signToken('fantasma', 0);
    const req = buildReq(`Bearer ${token}`);
    const next: NextFunction = vi.fn();

    await mw.use(req, RES, next);

    expect(req.authUser).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
