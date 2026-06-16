import 'reflect-metadata';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { AuthController } from '../../src/auth/auth.controller';
import type { FirebaseService } from '../../src/auth/firebase.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import { CompleteFirstLoginDto } from '../../src/auth/dto/complete-first-login.dto';
import '../../src/auth/auth-request.types';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
}

interface Mocks {
  controller: AuthController;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
}

function buildController(options: {
  user?: UserRow | { status: string } | null;
}): Mocks {
  const findUnique = vi.fn(() => Promise.resolve(options.user ?? null));
  const update = vi.fn(() => Promise.resolve({}));
  const setPassword = vi.fn(() => Promise.resolve());

  const prisma = {
    user: { findUnique, update },
  } as unknown as PrismaService;
  const firebase = { setPassword } as unknown as FirebaseService;
  const gamification = { awardPoints: vi.fn(() => Promise.resolve()) } as unknown as GamificationService;

  return { controller: new AuthController(prisma, firebase, gamification), findUnique, update, setPassword };
}

function buildReq(firebaseUid?: string): Request {
  return { firebaseUid } as unknown as Request;
}

function dto(newPassword: string): CompleteFirstLoginDto {
  const d = new CompleteFirstLoginDto();
  d.newPassword = newPassword;
  return d;
}

const ACTIVE_USER: AuthUser = { id: 'u1', email: 'colaborador@gtm.cl' };

describe('AuthController · GET /auth/me', () => {
  it('lanza 401 cuando no hay authUser', async () => {
    const { controller } = buildController({});
    await expect(controller.me(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('retorna los datos públicos del usuario cuando hay sesión', async () => {
    const { controller, findUnique } = buildController({
      user: {
        id: 'u1',
        email: 'colaborador@gtm.cl',
        firstName: 'Colaborador',
        lastName: 'Prueba',
        status: 'ACTIVE',
      },
    });

    const result = await controller.me(ACTIVE_USER);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, email: true, firstName: true, lastName: true, status: true },
    });
    expect(result).toEqual({
      id: 'u1',
      email: 'colaborador@gtm.cl',
      firstName: 'Colaborador',
      lastName: 'Prueba',
      status: 'ACTIVE',
    });
  });
});

describe('AuthController · POST /auth/first-login/complete', () => {
  it('lanza 401 cuando no hay authUser', async () => {
    const { controller } = buildController({});
    await expect(
      controller.completeFirstLogin(undefined, buildReq('fb-uid'), dto('password123')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lanza 401 cuando falta el firebaseUid en la sesión', async () => {
    const { controller } = buildController({ user: { status: 'PENDING_FIRST_LOGIN' } });
    await expect(
      controller.completeFirstLogin(ACTIVE_USER, buildReq(undefined), dto('password123')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lanza Conflict cuando el usuario ya está ACTIVE', async () => {
    const { controller, setPassword, update } = buildController({ user: { status: 'ACTIVE' } });
    await expect(
      controller.completeFirstLogin(ACTIVE_USER, buildReq('fb-uid'), dto('password123')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(setPassword).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('camino feliz: PENDING → fija password en Firebase y activa el usuario', async () => {
    const { controller, setPassword, update } = buildController({
      user: { status: 'PENDING_FIRST_LOGIN' },
    });

    const result = await controller.completeFirstLogin(
      ACTIVE_USER,
      buildReq('fb-uid'),
      dto('password123'),
    );

    expect(setPassword).toHaveBeenCalledWith('fb-uid', 'password123');
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { status: 'ACTIVE' } });
    expect(result).toEqual({ status: 'ACTIVE' });
  });
});
