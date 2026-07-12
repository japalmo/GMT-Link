import { describe, expect, it } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import {
  buildReimbursementSummary,
  type ReimbursementSummaryInput,
} from '../../src/modules/reimbursements/reimbursements-summary.util';

/** Entradas ya agregadas en BD (equivalente al escenario clásico de 5 filas). */
const input: ReimbursementSummaryInput = {
  statusCounts: [
    { status: FinanceStatus.PENDIENTE, count: 1 },
    { status: FinanceStatus.APROBADO, count: 3 },
    { status: FinanceStatus.PAGADO, count: 1 },
  ],
  approvedPendingAmount: 23000,
  ranking: [
    { userId: 'a', total: 15000 },
    { userId: 'b', total: 8000 },
  ],
  names: new Map([
    ['a', 'Ana'],
    ['b', 'Beto'],
  ]),
};

describe('buildReimbursementSummary', () => {
  it('monto aprobado pendiente de pago = suma de APROBADO agregada en BD', () => {
    expect(buildReimbursementSummary(input).approvedPendingAmount).toBe(23000);
  });

  it('cuenta pendientes de aprobación y aprobados pendientes de pago desde el groupBy por estado', () => {
    const s = buildReimbursementSummary(input);
    expect(s.pendingApprovalCount).toBe(1);
    expect(s.approvedPendingCount).toBe(3);
  });

  it('un estado ausente en el groupBy cuenta 0', () => {
    const s = buildReimbursementSummary({ ...input, statusCounts: [] });
    expect(s.pendingApprovalCount).toBe(0);
    expect(s.approvedPendingCount).toBe(0);
  });

  it('ranking por trabajador conserva el orden del groupBy y resuelve el nombre', () => {
    const s = buildReimbursementSummary(input);
    expect(s.rankingByWorker).toEqual([
      { userId: 'a', name: 'Ana', total: 15000 },
      { userId: 'b', name: 'Beto', total: 8000 },
    ]);
  });

  it('sin nombre resuelto cae en el userId (defensivo)', () => {
    const s = buildReimbursementSummary({ ...input, names: new Map() });
    expect(s.rankingByWorker[0]).toEqual({ userId: 'a', name: 'a', total: 15000 });
  });
});
