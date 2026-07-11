import { describe, expect, it } from 'vitest';
import { computeHours } from '../../src/modules/overtime/overtime-hours.util';

describe('computeHours', () => {
  it('mismo día: diferencia en horas decimales', () => {
    expect(computeHours('09:00', '11:30')).toBe(2.5);
    expect(computeHours('08:15', '17:15')).toBe(9);
  });

  it('cruce de medianoche: suma 24h', () => {
    expect(computeHours('22:00', '02:00')).toBe(4);
  });

  it('inicio == término => 0', () => {
    expect(computeHours('10:00', '10:00')).toBe(0);
  });

  it('redondea a 2 decimales', () => {
    expect(computeHours('09:00', '09:20')).toBe(0.33);
  });
});
