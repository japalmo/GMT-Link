import { describe, expect, it } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import { summarizeOvertime } from '../../src/modules/overtime/overtime-summary.util';

const rows = [
  { userId: 'a', requesterName: 'Ana', hours: 2, status: FinanceStatus.PENDIENTE, isDraft: false, projectId: 'p1', projectName: 'Puerto' },
  { userId: 'a', requesterName: 'Ana', hours: 3, status: FinanceStatus.APROBADO, isDraft: false, projectId: 'p1', projectName: 'Puerto' },
  { userId: 'b', requesterName: 'Beto', hours: 4, status: FinanceStatus.PENDIENTE, isDraft: false, projectId: 'p2', projectName: 'Mina' },
  { userId: 'b', requesterName: 'Beto', hours: null, status: FinanceStatus.PENDIENTE, isDraft: true, projectId: null, projectName: null },
];

describe('summarizeOvertime', () => {
  it('cuenta pendientes (no borrador), aprobadas y borradores', () => {
    const s = summarizeOvertime(rows);
    expect(s.pendingCount).toBe(2);
    expect(s.approvedCount).toBe(1);
    expect(s.draftCount).toBe(1);
  });

  it('ranking por trabajador por horas, desc', () => {
    const s = summarizeOvertime(rows);
    expect(s.rankingByWorker[0]).toEqual({ userId: 'a', name: 'Ana', hours: 5 });
    expect(s.rankingByWorker[1]).toEqual({ userId: 'b', name: 'Beto', hours: 4 });
  });

  it('agrupa por proyecto por horas, desc (ignora sin proyecto)', () => {
    const s = summarizeOvertime(rows);
    expect(s.byProject).toEqual(
      [
        { projectId: 'p2', name: 'Mina', hours: 4 },
        { projectId: 'p1', name: 'Puerto', hours: 5 },
      ].sort((x, y) => y.hours - x.hours),
    );
  });
});
