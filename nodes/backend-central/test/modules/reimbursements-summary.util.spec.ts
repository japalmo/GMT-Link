import { describe, expect, it } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import { summarizeReimbursements } from '../../src/modules/reimbursements/reimbursements-summary.util';

const rows = [
  { userId: 'a', requesterName: 'Ana', amount: 10000, status: FinanceStatus.APROBADO },
  { userId: 'a', requesterName: 'Ana', amount: 5000, status: FinanceStatus.APROBADO },
  { userId: 'b', requesterName: 'Beto', amount: 8000, status: FinanceStatus.APROBADO },
  { userId: 'b', requesterName: 'Beto', amount: 3000, status: FinanceStatus.PENDIENTE },
  { userId: 'c', requesterName: 'Cami', amount: 9000, status: FinanceStatus.PAGADO },
];

describe('summarizeReimbursements', () => {
  it('monto aprobado pendiente de pago = suma de APROBADO', () => {
    expect(summarizeReimbursements(rows).approvedPendingAmount).toBe(23000);
  });

  it('cuenta pendientes de aprobación y aprobados pendientes de pago', () => {
    const s = summarizeReimbursements(rows);
    expect(s.pendingApprovalCount).toBe(1);
    expect(s.approvedPendingCount).toBe(3);
  });

  it('ranking por trabajador por monto APROBADO, desc', () => {
    const s = summarizeReimbursements(rows);
    expect(s.rankingByWorker).toEqual([
      { userId: 'a', name: 'Ana', total: 15000 },
      { userId: 'b', name: 'Beto', total: 8000 },
    ]);
  });
});
