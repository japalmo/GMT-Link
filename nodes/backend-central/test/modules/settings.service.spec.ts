import 'reflect-metadata';
import type { UserPreferences } from '@prisma/client';
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
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
    ...overrides,
  };
}

interface PrismaParts {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
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
  };
  const prisma = { userPreferences: resolved } as unknown as PrismaService;
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

    expect(view).toEqual({ theme: 'system', notifyInApp: true, notifyEmail: false });
    expect(prismaBits.parts.findUnique.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(prismaBits.parts.upsert).not.toHaveBeenCalled();
  });

  it('con fila persistida devuelve sus valores (solo theme + canales)', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(buildRow({ theme: 'dark', notifyInApp: false, notifyEmail: true })),
    );
    service = new SettingsService(buildPrisma({ findUnique }).prisma);

    const view = await service.getMine('u1');

    expect(view).toEqual({ theme: 'dark', notifyInApp: false, notifyEmail: true });
  });

  it('normaliza un theme persistido inválido a "system" (defensivo)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ theme: 'legacy-azul' })));
    service = new SettingsService(buildPrisma({ findUnique }).prisma);

    const view = await service.getMine('u1');

    expect(view.theme).toBe('system');
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
    // Patch parcial: solo theme presente, sin notifyInApp/notifyEmail.
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
    expect(view).toEqual({ theme: 'dark', notifyInApp: false, notifyEmail: true });
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
