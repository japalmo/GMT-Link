import { describe, it, expect } from 'vitest';
import type { WorkScheduleView } from '@gmt-platform/contracts';
import { buildSchedulePreview, isWorkingDay, workingHours } from './schedule-preview';

/**
 * Semana de referencia con día conocido. Las fechas se construyen en hora LOCAL
 * (constructor por componentes), que es lo que lee el módulo vía `getDay()`.
 * En julio de 2026 el 12 cae domingo, así que el 13 es lunes y la semana calza.
 */
const SUNDAY = new Date(2026, 6, 12); // getDay() === 0 → ISO 7
const MONDAY = new Date(2026, 6, 13); // ISO 1
const TUESDAY = new Date(2026, 6, 14); // ISO 2
const WEDNESDAY = new Date(2026, 6, 15); // ISO 3
const THURSDAY = new Date(2026, 6, 16); // ISO 4
const FRIDAY = new Date(2026, 6, 17); // ISO 5
const SATURDAY = new Date(2026, 6, 18); // ISO 6

/** Base ADMINISTRATIVO sin horas; cada prueba sobrescribe lo relevante. */
function schedule(overrides: Partial<WorkScheduleView> = {}): WorkScheduleView {
  return {
    shiftPattern: 'ADMINISTRATIVO',
    workDays: null,
    restDays: null,
    cycleStart: null,
    dayNight: 'DIA',
    startTime: null,
    endTime: null,
    weeklyHours: null,
    notes: null,
    updatedAt: '',
    ...overrides,
  };
}

describe('convención de día de la semana (isoWeekday, verificada vía isWorkingDay)', () => {
  it('las fechas de referencia tienen el getDay() esperado', () => {
    expect(SUNDAY.getDay()).toBe(0);
    expect(MONDAY.getDay()).toBe(1);
    expect(SATURDAY.getDay()).toBe(6);
  });

  it('mapea domingo (getDay 0) a ISO 7', () => {
    // weeklyHours con solo weekday=7 ⇒ trabaja únicamente el domingo.
    const s = schedule({ weeklyHours: [{ weekday: 7, start: '09:00', end: '13:00' }] });
    expect(isWorkingDay(s, SUNDAY)).toBe(true);
    expect(isWorkingDay(s, MONDAY)).toBe(false);
    expect(isWorkingDay(s, SATURDAY)).toBe(false);
  });

  it('mapea lunes..sábado a ISO 1..6 sin cambio', () => {
    const cases: Array<[Date, number]> = [
      [MONDAY, 1],
      [TUESDAY, 2],
      [WEDNESDAY, 3],
      [THURSDAY, 4],
      [FRIDAY, 5],
      [SATURDAY, 6],
    ];
    for (const [date, iso] of cases) {
      const s = schedule({ weeklyHours: [{ weekday: iso, start: '09:00', end: '13:00' }] });
      expect(isWorkingDay(s, date)).toBe(true);
      // El domingo (ISO 7) nunca coincide con un weekday 1..6.
      expect(isWorkingDay(s, SUNDAY)).toBe(false);
    }
  });
});

describe('isWorkingDay · ADMINISTRATIVO con weeklyHours', () => {
  it('trabaja exactamente los días listados (incluye sábado y domingo)', () => {
    const s = schedule({
      weeklyHours: [
        { weekday: 6, start: '10:00', end: '14:00' }, // sábado
        { weekday: 7, start: '10:00', end: '14:00' }, // domingo
      ],
    });
    expect(isWorkingDay(s, SATURDAY)).toBe(true);
    expect(isWorkingDay(s, SUNDAY)).toBe(true);
    expect(isWorkingDay(s, MONDAY)).toBe(false);
    expect(isWorkingDay(s, WEDNESDAY)).toBe(false);
  });

  it('un día ausente del arreglo es descanso', () => {
    const s = schedule({
      weeklyHours: [
        { weekday: 1, start: '09:00', end: '18:00' },
        { weekday: 3, start: '09:00', end: '18:00' },
        { weekday: 5, start: '09:00', end: '18:00' },
      ],
    });
    expect(isWorkingDay(s, MONDAY)).toBe(true);
    expect(isWorkingDay(s, WEDNESDAY)).toBe(true);
    expect(isWorkingDay(s, FRIDAY)).toBe(true);
    expect(isWorkingDay(s, TUESDAY)).toBe(false);
    expect(isWorkingDay(s, THURSDAY)).toBe(false);
    expect(isWorkingDay(s, SATURDAY)).toBe(false);
    expect(isWorkingDay(s, SUNDAY)).toBe(false);
  });
});

describe('isWorkingDay · ADMINISTRATIVO legacy (sin weeklyHours)', () => {
  it('trabaja lunes a viernes y descansa sábado y domingo', () => {
    // Fila legacy: weeklyHours null con jornada única startTime/endTime.
    const s = schedule({ weeklyHours: null, startTime: '08:00', endTime: '18:00' });
    expect(isWorkingDay(s, MONDAY)).toBe(true);
    expect(isWorkingDay(s, TUESDAY)).toBe(true);
    expect(isWorkingDay(s, WEDNESDAY)).toBe(true);
    expect(isWorkingDay(s, THURSDAY)).toBe(true);
    expect(isWorkingDay(s, FRIDAY)).toBe(true);
    expect(isWorkingDay(s, SATURDAY)).toBe(false);
    expect(isWorkingDay(s, SUNDAY)).toBe(false);
  });

  it('decide el día por getDay() aunque no haya horas definidas', () => {
    // El código legacy sólo mira getDay(); no depende de startTime/endTime.
    const s = schedule({ weeklyHours: null, startTime: null, endTime: null });
    expect(isWorkingDay(s, MONDAY)).toBe(true);
    expect(isWorkingDay(s, SUNDAY)).toBe(false);
  });
});

describe('isWorkingDay · patrón cíclico', () => {
  it('7x7: los primeros 7 días desde cycleStart son faena y los 7 siguientes, descanso', () => {
    const s = schedule({
      shiftPattern: 'SIETE_POR_SIETE',
      workDays: 7,
      restDays: 7,
      cycleStart: '2026-07-13', // lunes, día 1 en faena
      startTime: '08:00',
      endTime: '20:00',
    });
    expect(isWorkingDay(s, new Date(2026, 6, 13))).toBe(true); // día 0
    expect(isWorkingDay(s, new Date(2026, 6, 19))).toBe(true); // día 6
    expect(isWorkingDay(s, new Date(2026, 6, 20))).toBe(false); // día 7
    expect(isWorkingDay(s, new Date(2026, 6, 26))).toBe(false); // día 13
    expect(isWorkingDay(s, new Date(2026, 6, 27))).toBe(true); // día 14 (nuevo ciclo)
  });

  it('devuelve null si falta la fecha de inicio de ciclo', () => {
    const s = schedule({
      shiftPattern: 'SIETE_POR_SIETE',
      workDays: 7,
      restDays: 7,
      cycleStart: null,
    });
    expect(isWorkingDay(s, MONDAY)).toBeNull();
  });
});

describe('workingHours', () => {
  it('ADMINISTRATIVO con weeklyHours devuelve las horas del día correspondiente', () => {
    const s = schedule({
      weeklyHours: [
        { weekday: 1, start: '09:00', end: '17:00' }, // lunes
        { weekday: 6, start: '10:00', end: '14:00' }, // sábado
      ],
    });
    expect(workingHours(s, MONDAY)).toBe('09:00-17:00');
    expect(workingHours(s, SATURDAY)).toBe('10:00-14:00');
  });

  it('ADMINISTRATIVO con weeklyHours devuelve null en un día no listado', () => {
    const s = schedule({ weeklyHours: [{ weekday: 1, start: '09:00', end: '17:00' }] });
    expect(workingHours(s, TUESDAY)).toBeNull();
  });

  it('devuelve null si la entrada del día tiene horas vacías', () => {
    const s = schedule({ weeklyHours: [{ weekday: 1, start: '', end: '' }] });
    expect(workingHours(s, MONDAY)).toBeNull();
  });

  it('fallback legacy (sin weeklyHours) usa la jornada única startTime/endTime', () => {
    const s = schedule({ weeklyHours: null, startTime: '08:00', endTime: '18:00' });
    expect(workingHours(s, MONDAY)).toBe('08:00-18:00');
    // La jornada única aplica a cualquier fecha; el filtro de día lo hace isWorkingDay.
    expect(workingHours(s, SUNDAY)).toBe('08:00-18:00');
  });

  it('en patrón cíclico usa la jornada única startTime/endTime', () => {
    const s = schedule({
      shiftPattern: 'SIETE_POR_SIETE',
      workDays: 7,
      restDays: 7,
      cycleStart: '2026-07-13',
      startTime: '08:00',
      endTime: '20:00',
    });
    expect(workingHours(s, new Date(2026, 6, 13))).toBe('08:00-20:00');
  });

  it('devuelve null cuando no hay weeklyHours ni jornada única', () => {
    const s = schedule({ weeklyHours: null, startTime: null, endTime: null });
    expect(workingHours(s, MONDAY)).toBeNull();
  });
});

describe('buildSchedulePreview', () => {
  it('marca faena/descanso y horas por día para ADMINISTRATIVO con weeklyHours', () => {
    const s = schedule({
      weeklyHours: [
        { weekday: 1, start: '09:00', end: '18:00' }, // lunes
        { weekday: 2, start: '09:00', end: '18:00' }, // martes
      ],
    });
    // Desde el lunes: lunes (faena), martes (faena), miércoles (descanso).
    const preview = buildSchedulePreview(s, MONDAY, 3);
    expect(preview).toHaveLength(3);
    expect(preview[0]).toMatchObject({ working: true, hours: '09:00-18:00' });
    expect(preview[1]).toMatchObject({ working: true, hours: '09:00-18:00' });
    expect(preview[2]).toMatchObject({ working: false, hours: null });
  });

  it('devuelve [] cuando un patrón cíclico no tiene fecha de inicio de ciclo', () => {
    const s = schedule({
      shiftPattern: 'SIETE_POR_SIETE',
      workDays: 7,
      restDays: 7,
      cycleStart: null,
      startTime: '08:00',
      endTime: '20:00',
    });
    expect(buildSchedulePreview(s, MONDAY, 14)).toEqual([]);
  });
});
