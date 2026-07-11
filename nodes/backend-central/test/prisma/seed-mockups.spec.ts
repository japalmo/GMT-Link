import { describe, it, expect } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import {
  MOCKUPS,
  ADMIN_TI_ROLE,
  MOCKUP_PASSWORD,
  mockupEmail,
  isMockupSeedEnabled,
  isDecidedStatus,
  buildReimbursements,
  buildOvertime,
  REIMBURSEMENT_SAMPLES,
  OVERTIME_SAMPLES,
} from '../../prisma/seed-mockups.core';

describe('isMockupSeedEnabled', () => {
  it('true solo con SEED_MOCKUPS on/1/true (case-insensitive)', () => {
    for (const v of ['on', '1', 'true', 'TRUE', ' On ']) {
      expect(isMockupSeedEnabled({ SEED_MOCKUPS: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });
  it('false si falta o está apagado (no depende de NODE_ENV)', () => {
    expect(isMockupSeedEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isMockupSeedEnabled({ SEED_MOCKUPS: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isMockupSeedEnabled({ SEED_MOCKUPS: '0' } as NodeJS.ProcessEnv)).toBe(false);
    // NODE_ENV=production NO habilita por sí solo (web-dev comparte api prod).
    expect(isMockupSeedEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('MOCKUPS', () => {
  it('son 10, uno por rol de la spec §6', () => {
    expect(MOCKUPS).toHaveLength(10);
  });
  it('usernames únicos, con prefijo mock_ y email @example.test', () => {
    const usernames = MOCKUPS.map((m) => m.username);
    expect(new Set(usernames).size).toBe(10);
    for (const m of MOCKUPS) {
      expect(m.username.startsWith('mock_')).toBe(true);
      expect(mockupEmail(m.username)).toBe(`${m.username}@example.test`);
    }
  });
  it('cubre exactamente los roleKeys esperados (RESOLUCIÓN #5: admin_ti, NO org_admin)', () => {
    const roleKeys = MOCKUPS.map((m) => m.roleKey).sort();
    expect(roleKeys).toEqual(
      [
        'admin_contrato',
        'admin_finanzas',
        'admin_ti',
        'analista_finanzas',
        'analista_rh',
        'asesor_hse',
        'gerencia_general',
        'gerencia_proyectos',
        'gerencia_rh',
        'trabajador',
      ].sort(),
    );
    expect(MOCKUPS.find((m) => m.username === 'mock_admin_ti')?.roleKey).toBe(ADMIN_TI_ROLE);
    expect(ADMIN_TI_ROLE).toBe('admin_ti');
    // Ningún mockup usa org_admin (el "admin TI" prueba el bundle admin_ti real).
    expect(MOCKUPS.some((m) => m.roleKey === 'org_admin')).toBe(false);
  });
  it('clave conocida definida', () => {
    expect(MOCKUP_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });
});

describe('buildReimbursements / buildOvertime', () => {
  const now = new Date('2026-07-10T12:00:00Z');
  const idByUsername = new Map(MOCKUPS.map((m, i) => [m.username, `id-${i}`]));

  it('reembolsos: un row por sample, userId resuelto, decidedBy solo en estados decididos', () => {
    const rows = buildReimbursements(idByUsername, now);
    expect(rows).toHaveLength(REIMBURSEMENT_SAMPLES.length);
    for (const r of rows) {
      expect([...idByUsername.values()]).toContain(r.userId);
      expect(r.amount).toBeGreaterThan(0);
      expect(Number.isInteger(r.amount)).toBe(true);
      const decided = isDecidedStatus(r.status);
      expect(r.decidedById !== null).toBe(decided);
      expect(r.decidedAt !== null).toBe(decided);
      if (r.decidedById) expect([...idByUsername.values()]).toContain(r.decidedById);
      expect(r.date.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('reembolsos: hay estados variados (pendiente, aprobado, pagado, rechazado)', () => {
    const statuses = new Set(buildReimbursements(idByUsername, now).map((r) => r.status));
    expect(statuses.has(FinanceStatus.PENDIENTE)).toBe(true);
    expect(statuses.has(FinanceStatus.APROBADO)).toBe(true);
    expect(statuses.has(FinanceStatus.PAGADO)).toBe(true);
    expect(statuses.has(FinanceStatus.RECHAZADO)).toBe(true);
  });

  it('horas extra: forma correcta; borradores sin horas; onBehalf presente', () => {
    const rows = buildOvertime(idByUsername, now);
    expect(rows).toHaveLength(OVERTIME_SAMPLES.length);
    let draftCount = 0;
    let onBehalfCount = 0;
    for (const r of rows) {
      expect([...idByUsername.values()]).toContain(r.userId);
      const decided = isDecidedStatus(r.status);
      expect(r.decidedById !== null).toBe(decided);
      if (r.decidedById) expect([...idByUsername.values()]).toContain(r.decidedById);
      if (r.isDraft) {
        draftCount++;
        expect(r.hours).toBeNull();
        expect(r.endTime).toBeNull();
        expect(r.status).toBe(FinanceStatus.PENDIENTE); // un borrador nunca está decidido
      } else {
        expect(r.hours).not.toBeNull();
        expect(r.hours as number).toBeGreaterThan(0);
      }
      if (r.onBehalfOfUserId !== null) {
        onBehalfCount++;
        expect([...idByUsername.values()]).toContain(r.onBehalfOfUserId);
      }
    }
    expect(draftCount).toBeGreaterThanOrEqual(1);
    expect(onBehalfCount).toBeGreaterThanOrEqual(1);
  });

  it('lanza si un requester no está en el mapa de ids', () => {
    expect(() => buildReimbursements(new Map(), now)).toThrow();
    expect(() => buildOvertime(new Map(), now)).toThrow();
  });
});
