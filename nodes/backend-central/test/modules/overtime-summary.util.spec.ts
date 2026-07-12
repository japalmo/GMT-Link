import { describe, expect, it } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import {
  buildOvertimeSummary,
  type OvertimeSummaryInput,
} from '../../src/modules/overtime/overtime-summary.util';

/** Entradas ya agregadas en BD (equivalente al escenario clásico de 4 filas). */
const input: OvertimeSummaryInput = {
  statusCounts: [
    { status: FinanceStatus.PENDIENTE, isDraft: false, count: 2 },
    { status: FinanceStatus.APROBADO, isDraft: false, count: 1 },
    { status: FinanceStatus.PENDIENTE, isDraft: true, count: 1 },
  ],
  ranking: [
    { userId: 'a', hours: 5 },
    { userId: 'b', hours: 4 },
  ],
  byProject: [
    { projectId: 'p1', hours: 5 },
    { projectId: 'p2', hours: 4 },
  ],
  workerNames: new Map([
    ['a', 'Ana'],
    ['b', 'Beto'],
  ]),
  projectNames: new Map([
    ['p1', 'Puerto'],
    ['p2', 'Mina'],
  ]),
};

describe('buildOvertimeSummary', () => {
  it('cuenta pendientes (no borrador), aprobadas y borradores desde el groupBy estado+borrador', () => {
    const s = buildOvertimeSummary(input);
    expect(s.pendingCount).toBe(2);
    expect(s.approvedCount).toBe(1);
    expect(s.draftCount).toBe(1);
  });

  it('un borrador nunca cuenta como pendiente ni aprobado', () => {
    const s = buildOvertimeSummary({
      ...input,
      statusCounts: [{ status: FinanceStatus.APROBADO, isDraft: true, count: 4 }],
    });
    expect(s.pendingCount).toBe(0);
    expect(s.approvedCount).toBe(0);
    expect(s.draftCount).toBe(4);
  });

  it('ranking por trabajador conserva el orden del groupBy y resuelve el nombre', () => {
    const s = buildOvertimeSummary(input);
    expect(s.rankingByWorker[0]).toEqual({ userId: 'a', name: 'Ana', hours: 5 });
    expect(s.rankingByWorker[1]).toEqual({ userId: 'b', name: 'Beto', hours: 4 });
  });

  it('agrupa por proyecto conservando el orden del groupBy y resuelve el nombre', () => {
    const s = buildOvertimeSummary(input);
    expect(s.byProject).toEqual([
      { projectId: 'p1', name: 'Puerto', hours: 5 },
      { projectId: 'p2', name: 'Mina', hours: 4 },
    ]);
  });

  it('sin nombre resuelto cae en el id (defensivo)', () => {
    const s = buildOvertimeSummary({ ...input, workerNames: new Map(), projectNames: new Map() });
    expect(s.rankingByWorker[0]?.name).toBe('a');
    expect(s.byProject[0]?.name).toBe('p1');
  });
});
