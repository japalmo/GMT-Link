import 'reflect-metadata';
import type { UserPreferences } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { SettingsService } from '../../src/modules/settings/settings.service';

/** Construye una fila UserPreferences completa con overrides. */
function buildRow(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    id: 'pref-1',
    userId: 'u1',
    theme: 'system',
    notifyInApp: true,
    notifyEmail: false,
    notifyEmailTarget: null,
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
    ...overrides,
  };
}

interface PrismaParts {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  userFindUnique: ReturnType<typeof vi.fn>;
}

/** Firma con la que el servicio invoca `userPreferences.upsert`. */
type UpsertArgs = {
  where: { userId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function buildPrisma(
  parts: Partial<PrismaParts> = {},
): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    upsert: parts.upsert ?? vi.fn(() => Promise.resolve(buildRow())),
    userFindUnique:
      parts.userFindUnique ??
      vi.fn(() =>
        Promise.resolve({ emailInstitucionalVerified: null, emailPersonalVerified: null }),
      ),
  };
  const prisma = {
    userPreferences: { findUnique: resolved.findUnique, upsert: resolved.upsert },
    user: { findUnique: resolved.userFindUnique },
  } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

describe('SettingsService.getMine', () => {
  let prismaBits: ReturnType<typeof buildPrisma>;
  let service: SettingsService;

  beforeEach(() => {
    prismaBits = buildPrisma();
    service = new SettingsService(prismaBits.prisma);
  });

  it('sin fila persistida devuelve los defaults del schema (lazy, sin escribir)', async () => {
    const view = await service.getMine('u1');

    expect(view).toEqual({
      theme: 'system',
      notifyInApp: true,
      notifyEmail: false,
      notifyEmailTarget: null,
    });
    expect(prismaBits.parts.findUnique.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(prismaBits.parts.upsert).not.toHaveBeenCalled();
  });

  it('con fila persistida devuelve sus valores (theme + canales + destino de email)', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(
        buildRow({
          theme: 'dark',
          notifyInApp: false,
          notifyEmail: true,
          notifyEmailTarget: 'INSTITUCIONAL',
        }),
      ),
    );
    service = new SettingsService(buildPrisma({ findUnique }).prisma);

    const view = await service.getMine('u1');

    expect(view).toEqual({
      theme: 'dark',
      notifyInApp: false,
      notifyEmail: true,
      notifyEmailTarget: 'INSTITUCIONAL',
    });
  });

  it('normaliza un theme persistido inválido a "system" (defensivo)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ theme: 'legacy-azul' })));
    service = new SettingsService(buildPrisma({ findUnique }).prisma);

    const view = await service.getMine('u1');

    expect(view.theme).toBe('system');
  });

  it('normaliza un notifyEmailTarget persistido inválido a null (defensivo)', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(buildRow({ notifyEmailTarget: 'legacy-x' })),
    );
    service = new SettingsService(buildPrisma({ findUnique }).prisma);

    const view = await service.getMine('u1');

    expect(view.notifyEmailTarget).toBeNull();
  });
});

describe('SettingsService.updateMine', () => {
  it('hace upsert SOLO del propio usuario y aplica únicamente los campos enviados', async () => {
    const upsert = vi.fn<(args: UpsertArgs) => Promise<UserPreferences>>(() =>
      Promise.resolve(buildRow({ theme: 'light' })),
    );
    const service = new SettingsService(buildPrisma({ upsert }).prisma);

    const view = await service.updateMine('u1', { theme: 'light' });

    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ userId: 'u1' });
    // Patch parcial: solo theme presente, sin notifyInApp/notifyEmail/notifyEmailTarget.
    expect(args?.update).toEqual({ theme: 'light' });
    expect(args?.create).toEqual({ userId: 'u1', theme: 'light' });
    expect(view.theme).toBe('light');
  });

  it('aplica varios campos a la vez (theme + canales)', async () => {
    const upsert = vi.fn<(args: UpsertArgs) => Promise<UserPreferences>>(() =>
      Promise.resolve(buildRow({ theme: 'dark', notifyInApp: false, notifyEmail: true })),
    );
    const service = new SettingsService(buildPrisma({ upsert }).prisma);

    const view = await service.updateMine('u1', {
      theme: 'dark',
      notifyInApp: false,
      notifyEmail: true,
    });

    const args = upsert.mock.calls[0]?.[0];
    expect(args?.update).toEqual({ theme: 'dark', notifyInApp: false, notifyEmail: true });
    expect(view).toEqual({
      theme: 'dark',
      notifyInApp: false,
      notifyEmail: true,
      notifyEmailTarget: null,
    });
  });

  it('un PATCH con notifyInApp=false no toca theme (no lo fuerza a default)', async () => {
    const upsert = vi.fn<(args: UpsertArgs) => Promise<UserPreferences>>(() =>
      Promise.resolve(buildRow({ notifyInApp: false })),
    );
    const service = new SettingsService(buildPrisma({ upsert }).prisma);

    await service.updateMine('u1', { notifyInApp: false });

    const args = upsert.mock.calls[0]?.[0];
    expect(args?.update).toEqual({ notifyInApp: false });
    expect(args?.update).not.toHaveProperty('theme');
  });
});

describe('SettingsService.updateMine — notifyEmailTarget verificado', () => {
  it('persiste el destino si apunta a un correo VERIFICADO', async () => {
    const upsert = vi.fn<(args: UpsertArgs) => Promise<UserPreferences>>(() =>
      Promise.resolve(buildRow({ notifyEmailTarget: 'INSTITUCIONAL' })),
    );
    const userFindUnique = vi.fn(() =>
      Promise.resolve({
        emailInstitucionalVerified: new Date('2026-07-01T00:00:00.000Z'),
        emailPersonalVerified: null,
      }),
    );
    const service = new SettingsService(buildPrisma({ upsert, userFindUnique }).prisma);

    const view = await service.updateMine('u1', { notifyEmailTarget: 'INSTITUCIONAL' });

    const args = upsert.mock.calls[0]?.[0];
    expect(args?.update).toEqual({ notifyEmailTarget: 'INSTITUCIONAL' });
    expect(args?.create).toEqual({ userId: 'u1', notifyEmailTarget: 'INSTITUCIONAL' });
    expect(view.notifyEmailTarget).toBe('INSTITUCIONAL');
  });

  it('400 si el destino apunta a un correo NO verificado (y no persiste)', async () => {
    const upsert = vi.fn<(args: UpsertArgs) => Promise<UserPreferences>>(() =>
      Promise.resolve(buildRow()),
    );
    const userFindUnique = vi.fn(() =>
      Promise.resolve({
        emailInstitucionalVerified: new Date('2026-07-01T00:00:00.000Z'),
        emailPersonalVerified: null,
      }),
    );
    const service = new SettingsService(buildPrisma({ upsert, userFindUnique }).prisma);

    await expect(
      service.updateMine('u1', { notifyEmailTarget: 'PERSONAL' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('404 si el usuario ya no existe al validar el destino', async () => {
    const userFindUnique = vi.fn(() => Promise.resolve(null));
    const service = new SettingsService(buildPrisma({ userFindUnique }).prisma);

    await expect(
      service.updateMine('u1', { notifyEmailTarget: 'INSTITUCIONAL' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
