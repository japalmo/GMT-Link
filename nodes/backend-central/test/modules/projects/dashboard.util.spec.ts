import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  computeProjectDashboard,
  type DashboardActivity,
} from '../../../src/modules/projects/dashboard.util';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function act(over: Partial<DashboardActivity> = {}): DashboardActivity {
  return {
    groupId: 's1',
    groupName: 'Servicio 1',
    status: 'PENDIENTE',
    weight: 0,
    startDate: null,
    dueDate: null,
    completedAt: null,
    ...over,
  };
}

describe('dashboard.util — computeMetrics', () => {
  it('conjunto vacío: todo en cero y fechas nulas', () => {
    const m = computeMetrics([], NOW);
    expect(m).toMatchObject({
      total: 0,
      completed: 0,
      inProgress: 0,
      realProgress: 0,
      projectedProgress: 0,
      programEndDate: null,
      estimatedEndDate: null,
      deviationDays: null,
    });
    expect(m.realCurve).toEqual([]);
    expect(m.projectedCurve).toEqual([]);
  });

  it('sin ponderación (todas peso 0): peso igual, 2 de 4 completadas = 50%', () => {
    const acts = [
      act({ status: 'COMPLETADO', completedAt: new Date('2026-05-01') }),
      act({ status: 'COMPLETADO', completedAt: new Date('2026-06-01') }),
      act({ status: 'EN_PROGRESO' }),
      act({ status: 'PENDIENTE' }),
    ];
    const m = computeMetrics(acts, NOW);
    expect(m.total).toBe(4);
    expect(m.completed).toBe(2);
    expect(m.inProgress).toBe(2);
    expect(m.realProgress).toBe(50);
  });

  it('con ponderación: usa estimatedPoints, no el conteo', () => {
    const acts = [
      act({ status: 'COMPLETADO', weight: 30, completedAt: new Date('2026-05-01') }),
      act({ status: 'PENDIENTE', weight: 10 }),
    ];
    const m = computeMetrics(acts, NOW);
    // 30 de 40 = 75% (ponderado), no 50% (conteo)
    expect(m.realProgress).toBe(75);
  });

  it('curvas, término programado y desviación', () => {
    const acts = [
      act({ status: 'COMPLETADO', weight: 1, dueDate: new Date('2026-05-10'), completedAt: new Date('2026-05-05') }),
      act({ status: 'COMPLETADO', weight: 1, dueDate: new Date('2026-06-10'), completedAt: new Date('2026-06-12') }),
      act({ status: 'PENDIENTE', weight: 1, dueDate: new Date('2026-07-10') }),
      act({ status: 'PENDIENTE', weight: 1, dueDate: new Date('2026-08-10') }),
    ];
    const m = computeMetrics(acts, NOW);
    expect(m.completed).toBe(2);
    expect(m.realProgress).toBe(50);
    expect(m.programEndDate).toBe('2026-08-10'); // máxima dueDate
    expect(m.realCurve.length).toBeGreaterThan(0);
    expect(m.projectedCurve.length).toBeGreaterThan(0);
    // La curva proyectada llega a 100% al final (todas tienen dueDate).
    expect(m.projectedCurve[m.projectedCurve.length - 1]!.progress).toBe(100);
    // Con avance real hay término estimado y desviación calculada.
    expect(m.estimatedEndDate).not.toBeNull();
    expect(typeof m.deviationDays).toBe('number');
  });
});

describe('dashboard.util — computeProjectDashboard', () => {
  it('agrupa por servicio y arma el TOTAL', () => {
    const acts = [
      act({ groupId: 's1', groupName: 'Levantamiento', status: 'COMPLETADO', weight: 1, completedAt: new Date('2026-05-01') }),
      act({ groupId: 's1', groupName: 'Levantamiento', status: 'PENDIENTE', weight: 1 }),
      act({ groupId: 's2', groupName: 'Topografía', status: 'COMPLETADO', weight: 1, completedAt: new Date('2026-05-02') }),
    ];
    const d = computeProjectDashboard('p1', 'Proyecto X', 'SERVICE', acts, NOW);
    expect(d.grouping).toBe('SERVICE');
    expect(d.total.total).toBe(3);
    expect(d.total.completed).toBe(2);
    expect(d.groups).toHaveLength(2);
    const lev = d.groups.find((g) => g.name === 'Levantamiento')!;
    expect(lev.metrics.total).toBe(2);
    expect(lev.metrics.realProgress).toBe(50);
  });
});
