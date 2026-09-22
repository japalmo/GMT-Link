import { describe, expect, it } from 'vitest';
import {
  oneMonthBackSantiago,
  startOfTodaySantiago,
  santiagoDateParts,
} from '../../src/modules/finance/finance-time.util';
import { accountingMonth } from '../../src/modules/finance/finance-month.util';

describe('startOfTodaySantiago (día calendario de Chile)', () => {
  it('de noche hora Chile ancla al día chileno, no al UTC (bug del mes contable)', () => {
    // 2026-07-21T02:00Z = 20-jul 22:00 en Chile (invierno, UTC-4).
    const instant = new Date('2026-07-21T02:00:00.000Z');
    expect(startOfTodaySantiago(instant).toISOString()).toBe('2026-07-20T00:00:00.000Z');
    // El día 20 (23:00 hora Chile) NO debe caer en agosto.
    expect(accountingMonth(startOfTodaySantiago(instant))).toBe('2026-07');
  });

  it('pasada la medianoche de Chile sí cruza al día siguiente', () => {
    // 2026-07-21T04:30Z = 21-jul 00:30 en Chile.
    const instant = new Date('2026-07-21T04:30:00.000Z');
    expect(startOfTodaySantiago(instant).toISOString()).toBe('2026-07-21T00:00:00.000Z');
    expect(accountingMonth(startOfTodaySantiago(instant))).toBe('2026-08');
  });

  it('respeta el cambio de año (verano chileno, UTC-3)', () => {
    // 2026-12-21T02:00Z = 20-dic 23:00 en Chile (verano, UTC-3) => día 20 => diciembre.
    expect(accountingMonth(startOfTodaySantiago(new Date('2026-12-21T02:00:00.000Z')))).toBe(
      '2026-12',
    );
    // 2027-01-01T02:30Z = 31-dic 23:30 en Chile => día 31 => enero del año siguiente.
    expect(accountingMonth(startOfTodaySantiago(new Date('2027-01-01T02:30:00.000Z')))).toBe(
      '2027-01',
    );
  });

  it('es DST-safe: usa el offset correcto en verano (-3) y en invierno (-4)', () => {
    // Si ICU cayera a UTC, ambos darían el mismo día y esta prueba fallaría.
    // Verano (enero): 03:30Z - 3 = 00:30 del 15 => día 15.
    expect(santiagoDateParts(new Date('2026-01-15T03:30:00.000Z')).day).toBe(15);
    // Invierno (julio): 03:30Z - 4 = 23:30 del 14 => día 14.
    expect(santiagoDateParts(new Date('2026-07-15T03:30:00.000Z')).day).toBe(14);
  });
});

describe('regresión: la clasificación de fechas date-only NO cambia', () => {
  it('accountingMonth sobre valores date-only medianoche-UTC se mantiene', () => {
    // Una fecha elegida por el usuario (medianoche UTC) se clasifica igual que siempre.
    expect(accountingMonth(new Date('2026-07-20T00:00:00.000Z'))).toBe('2026-07');
    expect(accountingMonth(new Date('2026-07-21T00:00:00.000Z'))).toBe('2026-08');
  });
});

describe('oneMonthBackSantiago (ventana de un mes para las horas extra)', () => {
  it('el mismo día del mes anterior (22-sep → 22-ago)', () => {
    const instant = new Date('2026-09-22T15:00:00.000Z');
    expect(oneMonthBackSantiago(instant).toISOString()).toBe('2026-08-22T00:00:00.000Z');
  });

  it('cruza el año (10-ene → 10-dic del año anterior)', () => {
    const instant = new Date('2026-01-10T15:00:00.000Z');
    expect(oneMonthBackSantiago(instant).toISOString()).toBe('2025-12-10T00:00:00.000Z');
  });

  it('si el día no existe en el mes anterior, toma el último (31-mar → 28-feb)', () => {
    const instant = new Date('2026-03-31T15:00:00.000Z');
    expect(oneMonthBackSantiago(instant).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('usa el día de Chile, no el de UTC (01-ago 02:00Z = 31-jul en Chile → 30-jun)', () => {
    const instant = new Date('2026-08-01T02:00:00.000Z');
    expect(oneMonthBackSantiago(instant).toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });
});
