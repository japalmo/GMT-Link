import { describe, it, expect } from 'vitest';
import { resolveAdminSeed } from '../../prisma/seed-admin';

/**
 * resolveAdminSeed decide, según el entorno, con qué credenciales y estado se
 * siembra el admin:
 *  - dev: clave fija pública + ACTIVE (cómodo para desarrollo local).
 *  - prod: ADMIN_PASSWORD si está; si no, una aleatoria; status PENDING para
 *    forzar cambio de clave en el primer login.
 */
describe('resolveAdminSeed', () => {
  it('dev: usa la clave fija y status ACTIVE', () => {
    const r = resolveAdminSeed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(r.password).toBe('AdminGmt2026');
    expect(r.status).toBe('ACTIVE');
    expect(r.mustChangePassword).toBe(false);
    expect(r.generated).toBe(false);
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
    expect(r.password).not.toBe('AdminGmt2026');
  });

  it('prod nunca usa la clave pública fija', () => {
    const r = resolveAdminSeed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(r.password).not.toBe('AdminGmt2026');
  });
});
