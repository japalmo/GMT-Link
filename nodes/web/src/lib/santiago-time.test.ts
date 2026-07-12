import { describe, expect, it } from 'vitest';
import { todaySantiagoString, currentAccountingMonth } from './santiago-time';

describe('todaySantiagoString', () => {
  it('de noche hora Chile ancla al día chileno, no al UTC', () => {
    // 2026-07-21T02:00Z = 20-jul 22:00 en Chile (invierno, UTC-4).
    expect(todaySantiagoString(new Date('2026-07-21T02:00:00.000Z'))).toBe('2026-07-20');
  });

  it('es DST-safe: verano (-3) vs invierno (-4)', () => {
    // Verano (enero): 03:30Z - 3 = 00:30 del 15.
    expect(todaySantiagoString(new Date('2026-01-15T03:30:00.000Z'))).toBe('2026-01-15');
    // Invierno (julio): 03:30Z - 4 = 23:30 del 14.
    expect(todaySantiagoString(new Date('2026-07-15T03:30:00.000Z'))).toBe('2026-07-14');
  });
});

describe('currentAccountingMonth (cierre día 20, hora Chile)', () => {
  it('el 20 de noche hora Chile sigue en el mes en curso', () => {
    expect(currentAccountingMonth(new Date('2026-07-21T02:00:00.000Z'))).toBe('2026-07');
  });

  it('pasada la medianoche del 21 cruza al mes contable siguiente', () => {
    expect(currentAccountingMonth(new Date('2026-07-21T04:30:00.000Z'))).toBe('2026-08');
  });

  it('respeta el cambio de año', () => {
    // 31-dic 23:30 en Chile (verano, UTC-3).
    expect(currentAccountingMonth(new Date('2027-01-01T02:30:00.000Z'))).toBe('2027-01');
  });
});
