import { describe, expect, it } from 'vitest';
import { accountingMonth, monthRange } from '../../src/modules/finance/finance-month.util';

describe('accountingMonth (cierre día 20)', () => {
  it('día <= 20 => mes calendario', () => {
    expect(accountingMonth(new Date('2026-07-20T12:00:00.000Z'))).toBe('2026-07');
    expect(accountingMonth(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-07');
  });

  it('día > 20 => mes siguiente', () => {
    expect(accountingMonth(new Date('2026-07-21T00:00:00.000Z'))).toBe('2026-08');
    expect(accountingMonth(new Date('2026-12-31T00:00:00.000Z'))).toBe('2027-01');
  });
});

describe('monthRange', () => {
  it('cubre [prevMonth 21, thisMonth 21) para el mes contable', () => {
    const r = monthRange('2026-07');
    expect(r.gte.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });

  it('es consistente con accountingMonth en los bordes', () => {
    const r = monthRange('2026-08');
    const borde = new Date('2026-07-21T00:00:00.000Z');
    expect(borde >= r.gte && borde < r.lt).toBe(true);
    expect(accountingMonth(borde)).toBe('2026-08');
  });
});
