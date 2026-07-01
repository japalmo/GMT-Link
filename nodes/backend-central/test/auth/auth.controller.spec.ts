import 'reflect-metadata';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/auth/auth.controller';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import { CompleteFirstLoginDto } from '../../src/auth/dto/complete-first-login.dto';
import { verifyPassword } from '../../src/common/password';
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
  awardPoints: ReturnType<typeof vi.fn>;
}

function buildController(options: {
  user?: UserRow | { status: string } | null;
}): Mocks {
  const findUnique = vi.fn(() => Promise.resolve(options.user ?? null));
  const update = vi.fn(() => Promise.resolve({}));
  const awardPoints = vi.fn(() => Promise.resolve());

  const prisma = {
    user: { findUnique, update },
    membership: { findMany: vi.fn(() => Promise.resolve([])) },
    project: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;
  const gamification = { awardPoints } as unknown as GamificationService;

  return { controller: new AuthController(prisma, gamification), findUnique, update, awardPoints };
}

function dto(newPassword: string): CompleteFirstLoginDto {
  const d = new CompleteFirstLoginDto();
  d.newPassword = newPassword;
  return d;
}

const ACTIVE_USER: AuthUser = { id: 'u1', email: 'colaborador@gmt.cl' };

describe('AuthController · GET /auth/me', () => {
  it('lanza 401 cuando no hay authUser', async () => {
    const { controller } = buildController({});
    await expect(controller.me(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('retorna los datos públicos del usuario cuando hay sesión', async () => {
    const { controller, findUnique } = buildController({
      user: {
        id: 'u1',
        email: 'colaborador@gmt.cl',
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
      email: 'colaborador@gmt.cl',
      firstName: 'Colaborador',
      lastName: 'Prueba',
      status: 'ACTIVE',
      // sin memberships → todos los módulos (no se restringe el acceso)
      modules: ['dashboard', 'usuarios', 'directorio', 'finanzas', 'operaciones', 'recursos', 'herramientas', 'v-metric'],
    });
  });
});

describe('AuthController · POST /auth/first-login/complete', () => {
  it('lanza 401 cuando no hay authUser', async () => {
    const { controller } = buildController({});
    await expect(
      controller.completeFirstLogin(undefined, dto('password123')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lanza 401 cuando el usuario de la sesión ya no existe', async () => {
    const { controller, update } = buildController({ user: null });
    await expect(
      controller.completeFirstLogin(ACTIVE_USER, dto('password123')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
  });

  it('lanza Conflict cuando el usuario ya está ACTIVE', async () => {
    const { controller, update } = buildController({ user: { status: 'ACTIVE' } });
    await expect(
      controller.completeFirstLogin(ACTIVE_USER, dto('password123')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('camino feliz: PENDING → fija passwordHash (bcrypt) y activa el usuario', async () => {
    const { controller, update, awardPoints } = buildController({
      user: { status: 'PENDING_FIRST_LOGIN' },
    });

    const result = await controller.completeFirstLogin(ACTIVE_USER, dto('password123'));

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { passwordHash: string; status: string };
    };
    expect(call.where).toEqual({ id: 'u1' });
    expect(call.data.status).toBe('ACTIVE');
    expect(typeof call.data.passwordHash).toBe('string');
    expect(call.data.passwordHash.length).toBeGreaterThan(0);
    // el hash almacenado verifica contra la contraseña en claro
    await expect(verifyPassword('password123', call.data.passwordHash)).resolves.toBe(true);
    expect(awardPoints).toHaveBeenCalledWith('u1', 'FIRST_LOGIN');
    expect(result).toEqual({ status: 'ACTIVE' });
  });
});
