import { computeTaskPriority } from '../../../src/modules/tasks/priority.util';
import { describe, it, expect } from 'vitest';
describe('computeTaskPriority', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  it('respeta la prioridad actual si priorityManual es true', () => {
    expect(computeTaskPriority('URGENTE', true, null, now)).toBe('URGENTE');
    expect(computeTaskPriority('MEDIA', true, new Date('2026-07-28T10:00:00Z'), now)).toBe('MEDIA');
  });

  it('devuelve BAJA si no hay fecha de entrega', () => {
    expect(computeTaskPriority('ALTA', false, null, now)).toBe('BAJA');
  });

  it('devuelve BAJA si faltan más de 7 días', () => {
    const dueDate = new Date('2026-08-05T12:00:00Z'); // 8 días
    expect(computeTaskPriority('BAJA', false, dueDate, now)).toBe('BAJA');
  });

  it('devuelve MEDIA si faltan entre 3 y 7 días', () => {
    const dueDate7 = new Date('2026-08-04T12:00:00Z'); // 7 días exactos
    expect(computeTaskPriority('BAJA', false, dueDate7, now)).toBe('MEDIA');

    const dueDate4 = new Date('2026-08-01T12:00:00Z'); // 4 días
    expect(computeTaskPriority('BAJA', false, dueDate4, now)).toBe('MEDIA');
  });

  it('devuelve ALTA si faltan entre 0 y 3 días', () => {
    const dueDate3 = new Date('2026-07-31T12:00:00Z'); // 3 días exactos
    expect(computeTaskPriority('BAJA', false, dueDate3, now)).toBe('ALTA');

    const dueDate1 = new Date('2026-07-29T12:00:00Z'); // 1 día
    expect(computeTaskPriority('BAJA', false, dueDate1, now)).toBe('ALTA');

    const dueDate0 = new Date('2026-07-28T12:00:00Z'); // 0 días (mismo instante)
    expect(computeTaskPriority('BAJA', false, dueDate0, now)).toBe('ALTA');
  });

  it('devuelve URGENTE si la fecha ya pasó', () => {
    const dueDatePast = new Date('2026-07-27T12:00:00Z'); // -1 día
    expect(computeTaskPriority('BAJA', false, dueDatePast, now)).toBe('URGENTE');
  });

  it('respeta la prioridad ALTA fijada manualmente aunque esté vencida', () => {
    const dueDatePast = new Date('2026-07-27T12:00:00Z'); // Vencida
    expect(computeTaskPriority('ALTA', true, dueDatePast, now)).toBe('ALTA');
  });

  it('resuelve medianoche UTC de dueDate al fin del día en Chile', () => {
    // Si la tarea vence el 5 de agosto (medianoche UTC en DB: 2026-08-05T00:00:00Z)
    const dueDate = new Date('2026-08-05T00:00:00Z');
    
    // Si 'ahora' es 4 de agosto 20:00 en Chile (2026-08-05T00:00:00Z)
    // El 'todayUtcAnchor' será 2026-08-04T00:00:00Z.
    // msToDue será 1 día (ALTA). NO URGENTE!
    const nowChileEve = new Date('2026-08-05T00:00:00Z'); // 20:00 Chile (invierno)
    expect(computeTaskPriority('BAJA', false, dueDate, nowChileEve)).toBe('ALTA');

    // Si 'ahora' es 5 de agosto 20:00 en Chile (2026-08-06T00:00:00Z)
    // El 'todayUtcAnchor' será 2026-08-05T00:00:00Z.
    // msToDue será 0 días (ALTA).
    const nowChileDueDay = new Date('2026-08-06T00:00:00Z');
    expect(computeTaskPriority('BAJA', false, dueDate, nowChileDueDay)).toBe('ALTA');

    // Si 'ahora' es 6 de agosto 01:00 en Chile (2026-08-06T05:00:00Z)
    // El 'todayUtcAnchor' será 2026-08-06T00:00:00Z.
    // msToDue será -1 días (URGENTE).
    const nowChilePast = new Date('2026-08-06T05:00:00Z');
    expect(computeTaskPriority('BAJA', false, dueDate, nowChilePast)).toBe('URGENTE');
  });
});
