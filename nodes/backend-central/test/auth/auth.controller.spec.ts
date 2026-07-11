import 'reflect-metadata';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/auth/auth.controller';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import { CompleteFirstLoginDto } from '../../src/auth/dto/complete-first-login.dto';
import { hashPassword, verifyPassword } from '../../src/common/password';
import '../../src/auth/auth-request.types';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';
import type { FgaService } from '../../src/fga/fga.service';

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
  fgaCheck: ReturnType<typeof vi.fn>;
  permissionKeys: ReturnType<typeof vi.fn>;
}

function buildController(options: {
  user?: UserRow | { status: string; passwordHash?: string | null } | null;
  canManageRoles?: boolean;
  permissions?: string[];
}): Mocks {
  const findUnique = vi.fn(() => Promise.resolve(options.user ?? null));
  const update = vi.fn(() => Promise.resolve({}));
  const awardPoints = vi.fn(() => Promise.resolve());
  const fgaCheck = vi.fn(() => Promise.resolve(options.canManageRoles ?? false));
  const permissionKeys = vi.fn(() => Promise.resolve(options.permissions ?? []));

  const prisma = {
    user: { findUnique, update },
    membership: { findMany: vi.fn(() => Promise.resolve([])) },
    project: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;
  const gamification = { awardPoints } as unknown as GamificationService;
  const fga = { check: fgaCheck } as unknown as FgaService;
  const permissionService = {
    permissionKeysForUser: permissionKeys,
  } as unknown as import('../../src/authz/permission.service').PermissionService;

  return {
    controller: new AuthController(prisma, gamification, fga, permissionService),
    findUnique,
    update,
    awardPoints,
    fgaCheck,
    permissionKeys,
  };
}

function dto(newPassword: string, currentPassword = 'Provisoria-2026'): CompleteFirstLoginDto {
  const d = new CompleteFirstLoginDto();
  d.newPassword = newPassword;
  d.currentPassword = currentPassword;
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
      canManageRoles: false,
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
      // sin memberships ni permisos → solo los módulos por defecto (Inicio + Finanzas)
      modules: ['dashboard', 'finanzas'],
      permissions: [],
      canManageRoles: false,
    });
  });

  it('deriva el módulo "proyectos" cuando el usuario tiene project:manage', async () => {
    const { controller } = buildController({
      user: { id: 'u1', email: 'x@gmt.cl', firstName: 'X', lastName: 'Y', status: 'ACTIVE' },
      permissions: ['project:manage'],
    });
    const result = await controller.me(ACTIVE_USER);
    expect(result.permissions).toEqual(['project:manage']);
    expect(result.modules).toEqual(expect.arrayContaining(['dashboard', 'finanzas', 'proyectos']));
    expect(result.modules).not.toContain('usuarios');
  });

  it('system:beta:full → todos los módulos', async () => {
    const { controller } = buildController({
      user: { id: 'u1', email: 'x@gmt.cl', firstName: 'X', lastName: 'Y', status: 'ACTIVE' },
      permissions: ['system:beta:full'],
    });
    const result = await controller.me(ACTIVE_USER);
    expect(result.modules).toEqual([
      'dashboard', 'usuarios', 'directorio', 'finanzas', 'operaciones', 'proyectos', 'recursos', 'herramientas', 'v-metric',
    ]);
  });

  it('incluye canManageRoles=true consultando FGA (can_manage_roles sobre organization:gmt)', async () => {
    const { controller, fgaCheck } = buildController({
      user: {
        id: 'u1',
        email: 'admin@gmt.cl',
        firstName: 'Admin',
        lastName: 'GMT',
        status: 'ACTIVE',
      },
      canManageRoles: true,
    });

    const result = await controller.me(ACTIVE_USER);

    expect(fgaCheck).toHaveBeenCalledWith({
      user: 'user:u1',
      relation: 'can_manage_roles',
      object: 'organization:gmt',
    });
    expect(result.canManageRoles).toBe(true);
  });

  it('fail-closed: si FGA falla, canManageRoles=false y el /me no rompe (500)', async () => {
    const { controller, fgaCheck } = buildController({
      user: {
        id: 'u1',
        email: 'admin@gmt.cl',
        firstName: 'Admin',
        lastName: 'GMT',
        status: 'ACTIVE',
      },
      canManageRoles: true,
    });
    fgaCheck.mockImplementationOnce(() =>
      Promise.reject(new Error('OpenFGA no inicializado: FGA_STORE_ID vacío.')),
    );

    const result = await controller.me(ACTIVE_USER);

    expect(result.canManageRoles).toBe(false);
    expect(result.status).toBe('ACTIVE');
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

  it('camino feliz: PENDING + provisoria correcta → fija passwordHash (bcrypt) y activa el usuario', async () => {
    const provisionalHash = await hashPassword('Provisoria-2026');
    const { controller, update, awardPoints } = buildController({
      user: { status: 'PENDING_FIRST_LOGIN', passwordHash: provisionalHash },
    });

    const result = await controller.completeFirstLogin(
      ACTIVE_USER,
      dto('password123', 'Provisoria-2026'),
    );

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { passwordHash: string; status: string };
    };
    expect(call.where).toEqual({ id: 'u1' });
    expect(call.data.status).toBe('ACTIVE');
    expect(typeof call.data.passwordHash).toBe('string');
    expect(call.data.passwordHash.length).toBeGreaterThan(0);
    // el hash almacenado verifica contra la NUEVA contraseña en claro
    await expect(verifyPassword('password123', call.data.passwordHash)).resolves.toBe(true);
    expect(awardPoints).toHaveBeenCalledWith('u1', 'FIRST_LOGIN');
    expect(result).toEqual({ status: 'ACTIVE' });
  });

  it('re-auth: lanza 401 si la contraseña provisoria es incorrecta (no cambia la clave)', async () => {
    const provisionalHash = await hashPassword('Provisoria-2026');
    const { controller, update, awardPoints } = buildController({
      user: { status: 'PENDING_FIRST_LOGIN', passwordHash: provisionalHash },
    });

    await expect(
      controller.completeFirstLogin(ACTIVE_USER, dto('password123', 'CLAVE-EQUIVOCADA')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Un token filtrado en estado pendiente NO basta para tomar la cuenta.
    expect(update).not.toHaveBeenCalled();
    expect(awardPoints).not.toHaveBeenCalled();
  });

  it('re-auth: lanza 401 si el usuario no tiene passwordHash (no se puede verificar la provisoria)', async () => {
    const { controller, update, awardPoints } = buildController({
      user: { status: 'PENDING_FIRST_LOGIN', passwordHash: null },
    });

    await expect(
      controller.completeFirstLogin(ACTIVE_USER, dto('password123', 'loquesea')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
    expect(awardPoints).not.toHaveBeenCalled();
  });
});
