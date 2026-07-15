import { describe, expect, it } from 'vitest';
import {
  computeHours,
  computeOvertimeBreakdown,
  resolveShiftForDate,
  type ShiftScheduleInput,
} from '../../src/modules/overtime/overtime-hours.util';

/** Fecha date-only anclada a medianoche UTC (convención de finanzas). */
function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** WorkSchedule base ADMINISTRATIVO con horario semanal (oficina L-J 8-18, V 8-14). */
function adminSchedule(overrides: Partial<ShiftScheduleInput> = {}): ShiftScheduleInput {
  return {
    shiftPattern: 'ADMINISTRATIVO',
    workDays: null,
    restDays: null,
    cycleStart: null,
    startTime: '08:00',
    endTime: '18:00',
    weeklyHours: [
      { weekday: 1, start: '08:00', end: '18:00' },
      { weekday: 2, start: '08:00', end: '18:00' },
      { weekday: 3, start: '08:00', end: '18:00' },
      { weekday: 4, start: '08:00', end: '18:00' },
      { weekday: 5, start: '08:00', end: '14:00' },
    ],
    ...overrides,
  };
}

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

describe('resolveShiftForDate', () => {
  it('ADMINISTRATIVO con weeklyHours: horario del día de la semana', () => {
    // 2026-07-13 lunes, 2026-07-17 viernes (hasta 14:00).
    expect(resolveShiftForDate(adminSchedule(), utcDay('2026-07-13'))).toEqual({
      startMin: 480,
      endMin: 1080,
      label: '08:00-18:00',
    });
    expect(resolveShiftForDate(adminSchedule(), utcDay('2026-07-17'))).toEqual({
      startMin: 480,
      endMin: 840,
      label: '08:00-14:00',
    });
  });

  it('ADMINISTRATIVO: sábado/domingo no listados => descanso (null)', () => {
    expect(resolveShiftForDate(adminSchedule(), utcDay('2026-07-18'))).toBeNull();
    expect(resolveShiftForDate(adminSchedule(), utcDay('2026-07-19'))).toBeNull();
  });

  it('ADMINISTRATIVO legacy (weeklyHours null): lunes a viernes con jornada única', () => {
    const legacy = adminSchedule({ weeklyHours: null });
    expect(resolveShiftForDate(legacy, utcDay('2026-07-13'))?.label).toBe('08:00-18:00');
    expect(resolveShiftForDate(legacy, utcDay('2026-07-18'))).toBeNull();
  });

  it('turno NOCHE cruza medianoche: endMin desenrollado (+1440)', () => {
    const night = adminSchedule({ weeklyHours: [{ weekday: 1, start: '20:00', end: '08:00' }] });
    expect(resolveShiftForDate(night, utcDay('2026-07-13'))).toEqual({
      startMin: 1200,
      endMin: 1920,
      label: '20:00-08:00',
    });
  });

  it('cíclico 7x7: faena días 0..6, descanso 7..13, reinicia en 14', () => {
    const cyclic: ShiftScheduleInput = {
      shiftPattern: 'SIETE_POR_SIETE',
      workDays: 7,
      restDays: 7,
      cycleStart: utcDay('2026-07-13'),
      startTime: '08:00',
      endTime: '20:00',
      weeklyHours: null,
    };
    expect(resolveShiftForDate(cyclic, utcDay('2026-07-13'))?.label).toBe('08:00-20:00');
    expect(resolveShiftForDate(cyclic, utcDay('2026-07-19'))?.label).toBe('08:00-20:00');
    expect(resolveShiftForDate(cyclic, utcDay('2026-07-20'))).toBeNull();
    expect(resolveShiftForDate(cyclic, utcDay('2026-07-27'))?.label).toBe('08:00-20:00');
  });

  it('null sin jornada o cíclico sin cycleStart', () => {
    expect(resolveShiftForDate(null, utcDay('2026-07-13'))).toBeNull();
    expect(
      resolveShiftForDate(
        { shiftPattern: 'SIETE_POR_SIETE', workDays: 7, restDays: 7, cycleStart: null, startTime: '08:00', endTime: '20:00', weeklyHours: null },
        utcDay('2026-07-13'),
      ),
    ).toBeNull();
  });
});

describe('computeOvertimeBreakdown', () => {
  it('caso de la dueña: 06:00-18:00 con turno 08:00-18:00 => 2 h extra, 10 h turno', () => {
    const shift = resolveShiftForDate(adminSchedule(), utcDay('2026-07-13'));
    const b = computeOvertimeBreakdown('06:00', '18:00', shift);
    expect(b).toEqual({ totalHours: 12, regularHours: 10, overtimeHours: 2, shiftLabel: '08:00-18:00' });
  });

  it('extra antes Y después del turno: 06:00-20:00 con 08:00-18:00 => 4 h extra', () => {
    const shift = resolveShiftForDate(adminSchedule(), utcDay('2026-07-13'));
    const b = computeOvertimeBreakdown('06:00', '20:00', shift);
    expect(b.totalHours).toBe(14);
    expect(b.regularHours).toBe(10);
    expect(b.overtimeHours).toBe(4);
  });

  it('periodo enteramente dentro del turno => 0 h extra', () => {
    const shift = resolveShiftForDate(adminSchedule(), utcDay('2026-07-13'));
    const b = computeOvertimeBreakdown('09:00', '17:00', shift);
    expect(b).toEqual({ totalHours: 8, regularHours: 8, overtimeHours: 0, shiftLabel: '08:00-18:00' });
  });

  it('día de descanso (sin turno) => todo es hora extra', () => {
    const shift = resolveShiftForDate(adminSchedule(), utcDay('2026-07-18')); // sábado => null
    const b = computeOvertimeBreakdown('09:00', '13:00', shift);
    expect(b).toEqual({ totalHours: 4, regularHours: 0, overtimeHours: 4, shiftLabel: null });
  });

  it('turno NOCHE: 18:00-08:00 con turno 20:00-08:00 => 2 h extra (18:00-20:00)', () => {
    const night = adminSchedule({ weeklyHours: [{ weekday: 1, start: '20:00', end: '08:00' }] });
    const shift = resolveShiftForDate(night, utcDay('2026-07-13'));
    const b = computeOvertimeBreakdown('18:00', '08:00', shift);
    expect(b.totalHours).toBe(14);
    expect(b.regularHours).toBe(12);
    expect(b.overtimeHours).toBe(2);
  });
});
