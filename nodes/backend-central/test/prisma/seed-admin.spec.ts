import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { resolveAdminSeed, ensurePostgresUser } from '../../prisma/seed-admin.core';

/**
 * resolveAdminSeed decide, según el entorno, con qué credenciales y estado se
 * siembra el admin. NUNCA hay clave fija en el repo: la clave sale de
 * ADMIN_PASSWORD o, si falta, de una aleatoria fuerte.
 *  - dev: usa ADMIN_PASSWORD si está (o una aleatoria) + status ACTIVE (no
 *    fuerza cambio; cómodo para desarrollo local).
 *  - prod: ADMIN_PASSWORD si está; si no, una aleatoria; status PENDING para
 *    forzar cambio de clave en el primer login.
 */
describe('resolveAdminSeed', () => {
  it('dev con ADMIN_PASSWORD: usa esa clave, status ACTIVE, sin forzar cambio', () => {
    const r = resolveAdminSeed({
      NODE_ENV: 'development',
      ADMIN_PASSWORD: 'ClaveDevLocal!',
    } as NodeJS.ProcessEnv);
    expect(r.password).toBe('ClaveDevLocal!');
    expect(r.status).toBe('ACTIVE');
    expect(r.mustChangePassword).toBe(false);
    expect(r.generated).toBe(false);
  });

  it('dev sin ADMIN_PASSWORD: genera una clave aleatoria (nunca una fija del repo), status ACTIVE', () => {
    const r = resolveAdminSeed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(r.status).toBe('ACTIVE');
    expect(r.mustChangePassword).toBe(false);
    expect(r.generated).toBe(true);
    expect(r.password.length).toBeGreaterThanOrEqual(12);
  });

  it('prod con ADMIN_PASSWORD: usa esa clave y status PENDING_FIRST_LOGIN', () => {
    const r = resolveAdminSeed({ NODE_ENV: 'production', ADMIN_PASSWORD: 'MiClaveProdSuperSegura!' } as NodeJS.ProcessEnv);
    expect(r.password).toBe('MiClaveProdSuperSegura!');
    expect(r.status).toBe('PENDING_FIRST_LOGIN');
    expect(r.mustChangePassword).toBe(true);
    expect(r.generated).toBe(false);
  });

  it('prod sin ADMIN_PASSWORD: genera una clave aleatoria fuerte y status PENDING_FIRST_LOGIN', () => {
    const r = resolveAdminSeed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(r.status).toBe('PENDING_FIRST_LOGIN');
    expect(r.mustChangePassword).toBe(true);
    expect(r.generated).toBe(true);
    expect(r.password.length).toBeGreaterThanOrEqual(12);
  });
});

/**
 * Invariante de seguridad (C3): en producción, si el admin YA existe, el seed
 * NO debe re-bajar su clave ni su estado en cada release. Sólo refresca datos
 * cosméticos (firstName/lastName) y NO comunica ninguna credencial nueva.
 *
 * ensurePostgresUser recibe el PrismaClient por inyección: aquí se le pasa un
 * mock, sin tocar Postgres.
 */
describe('ensurePostgresUser · invariante de producción (admin existente)', () => {
  function buildPrisma(existing: { id: string; status: string } | null) {
    const findUnique = vi.fn(() => Promise.resolve(existing));
    const update = vi.fn<
      (args: { where: { email: string }; data: Record<string, unknown> }) => Promise<unknown>
    >();
    const upsert = vi.fn(
      (args: { create: Record<string, unknown>; update: Record<string, unknown> }) =>
        Promise.resolve({ id: 'nuevo-admin', email: 'admin@gmt.cl', status: args.create.status }),
    );
    const prisma = { user: { findUnique, update, upsert } } as unknown as PrismaClient;
    return { prisma, findUnique, update, upsert };
  }

  it('prod + admin ya existe: update SOLO de firstName/lastName (sin passwordHash ni status) y seededPassword=null', async () => {
    const { prisma, update, upsert } = buildPrisma({ id: 'admin-1', status: 'ACTIVE' });
    const resolution = resolveAdminSeed({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'ClaveQueNoDebeAplicarse!',
    } as NodeJS.ProcessEnv);

    const result = await ensurePostgresUser(prisma, resolution, true);

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    // La clave/estado del admin existente NO se tocan: sólo datos cosméticos.
    expect(arg.data).toEqual({ firstName: 'Admin', lastName: 'GMT' });
    expect(arg.data).not.toHaveProperty('passwordHash');
    expect(arg.data).not.toHaveProperty('status');
    // No se usa el upsert (que sí traería passwordHash + status).
    expect(upsert).not.toHaveBeenCalled();
    // No se comunica ninguna credencial nueva.
    expect(result).toEqual({ id: 'admin-1', seededPassword: null });
  });

  it('prod + admin NO existe: siembra vía upsert con passwordHash + status y devuelve la clave a comunicar', async () => {
    const { prisma, update, upsert } = buildPrisma(null);
    const resolution = resolveAdminSeed({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'ClaveProvisoria-2026!',
    } as NodeJS.ProcessEnv);

    const result = await ensurePostgresUser(prisma, resolution, true);

    expect(update).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(arg.create).toHaveProperty('passwordHash');
    expect(arg.create.status).toBe('PENDING_FIRST_LOGIN');
    // La clave a comunicar es la provisoria resuelta.
    expect(result.seededPassword).toBe('ClaveProvisoria-2026!');
  });
});
