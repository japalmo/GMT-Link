import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { ProfileService } from '../../src/modules/profile/profile.service';
import { verifyPassword } from '../../src/common/password';
import type { UpdateProfileDto } from '../../src/modules/profile/dto/update-profile.dto';

/** Forma del User (con memberships) que devuelve Prisma en estos tests. */
interface FakeUserRow {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  avatarUrl: string | null;
  status: string;
  points: number;
  isClientUser: boolean;
  memberships: Array<{ roleKey: string; scopeType: string; scopeId: string }>;
}

function baseUser(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
  return {
    id: 'me-1',
    firstName: 'Ana',
    secondName: 'María',
    lastName: 'Pérez',
    secondLastName: 'Soto',
    email: 'ana@gmt.cl',
    avatarUrl: null,
    status: 'ACTIVE',
    points: 10,
    isClientUser: false,
    memberships: [
      { roleKey: 'operator', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      { roleKey: 'viewer', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
    ],
    ...overrides,
  };
}

/** Construye un ProfileService con un mock tipado de Prisma (sin Firebase). */
function buildService(opts: {
  findUser?: FakeUserRow | null;
  updateImpl?: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<FakeUserRow>;
}): {
  service: ProfileService;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const findUnique = vi.fn(() => Promise.resolve(opts.findUser ?? null));
  const update = vi.fn(
    opts.updateImpl ??
      ((args: { where: { id: string }; data: Record<string, unknown> }): Promise<FakeUserRow> =>
        Promise.resolve({ ...baseUser({ id: args.where.id }), ...args.data })),
  );

  const prisma = { user: { findUnique, update } } as unknown as PrismaService;

  return { service: new ProfileService(prisma), findUnique, update };
}

describe('ProfileService.getMe', () => {
  it('retorna el perfil propio con roleKeys ORG', async () => {
    const { service } = buildService({ findUser: baseUser() });

    const result = await service.getMe('me-1');

    expect(result).toEqual({
      id: 'me-1',
      firstName: 'Ana',
      secondName: 'María',
      lastName: 'Pérez',
      secondLastName: 'Soto',
      email: 'ana@gmt.cl',
      avatarUrl: null,
      status: 'ACTIVE',
      isClientUser: false,
      roleKeys: ['operator', 'viewer'],
    });
  });

  it('ignora memberships que no son ORGANIZATION:gmt al armar roleKeys', async () => {
    const { service } = buildService({
      findUser: baseUser({
        memberships: [
          { roleKey: 'operator', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
          { roleKey: 'qa', scopeType: 'PROJECT', scopeId: 'p1' },
        ],
      }),
    });

    const result = await service.getMe('me-1');
    expect(result.roleKeys).toEqual(['operator']);
  });

  it('lanza 404 si el usuario de la sesión ya no existe', async () => {
    const { service } = buildService({ findUser: null });
    await expect(service.getMe('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProfileService.updateMe', () => {
  it('actualiza SOLO el propio usuario (where.id = userId del controller, no del body)', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    await service.updateMe('me-1', { firstName: 'Anita' } as UpdateProfileDto);

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as { where: { id: string }; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: 'me-1' });
  });

  it('NO permite cambiar email, status, roles ni points: el data solo lleva campos editables', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    // Aunque el caller "ensucie" el DTO con campos prohibidos, el service arma
    // `data` a mano: solo los campos editables llegan a Prisma.
    const dirty = {
      firstName: 'Anita',
      avatarUrl: 'https://cdn.gmt.cl/a.png',
      email: 'hacker@evil.cl',
      status: 'SUSPENDED',
      points: 9999,
      roleKeys: ['org_admin'],
      id: 'otro-usuario',
    } as unknown as UpdateProfileDto;

    await service.updateMe('me-1', dirty);

    const arg = update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ firstName: 'Anita', avatarUrl: 'https://cdn.gmt.cl/a.png' });
    expect(arg.data).not.toHaveProperty('email');
    expect(arg.data).not.toHaveProperty('status');
    expect(arg.data).not.toHaveProperty('points');
    expect(arg.data).not.toHaveProperty('roleKeys');
    expect(arg.data).not.toHaveProperty('id');
  });

  it('normaliza string vacío a null en secondName/secondLastName/avatarUrl (limpiar campo)', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    await service.updateMe('me-1', {
      secondName: '',
      secondLastName: '',
      avatarUrl: '',
    } as UpdateProfileDto);

    const arg = update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ secondName: null, secondLastName: null, avatarUrl: null });
  });

  it('un DTO vacío no escribe ningún campo (data = {})', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    await service.updateMe('me-1', {} as UpdateProfileDto);

    const arg = update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({});
  });

  it('retorna el perfil actualizado con la misma forma que getMe', async () => {
    const { service } = buildService({
      updateImpl: (args) =>
        Promise.resolve(baseUser({ id: args.where.id, firstName: 'Anita', avatarUrl: 'https://x/y.png' })),
    });

    const result = await service.updateMe('me-1', {
      firstName: 'Anita',
      avatarUrl: 'https://x/y.png',
    } as UpdateProfileDto);

    expect(result.firstName).toBe('Anita');
    expect(result.avatarUrl).toBe('https://x/y.png');
    expect(result.email).toBe('ana@gmt.cl');
    expect(result.roleKeys).toEqual(['operator', 'viewer']);
  });

  it('traduce P2025 (registro no encontrado) a 404', async () => {
    const { service } = buildService({
      updateImpl: () => Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' })),
    });

    await expect(service.updateMe('ghost', { firstName: 'X' } as UpdateProfileDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProfileService.changePassword', () => {
  it('llama prisma.user.update con where:{id} y data.passwordHash, y retorna { ok: true }', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    const result = await service.changePassword('u1', 'newpass123');

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as { where: { id: string }; data: { passwordHash: string } };
    expect(arg.where).toEqual({ id: 'u1' });
    expect(typeof arg.data.passwordHash).toBe('string');
    expect(arg.data.passwordHash.length).toBeGreaterThan(0);
    expect(result).toEqual({ ok: true });
  });

  it('el passwordHash almacenado pasa la verificación bcrypt (round-trip)', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    await service.changePassword('u1', 'newpass123');

    const arg = update.mock.calls[0]?.[0] as { data: { passwordHash: string } };
    const stored = arg.data.passwordHash;
    await expect(verifyPassword('newpass123', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrongpass', stored)).resolves.toBe(false);
  });
});
