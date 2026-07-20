import { describe, it, expect } from 'vitest';
import {
  overtimeMonth,
  toFinanceRows,
  filterRows,
  aggregate,
  rankByWorker,
  rankByProject,
} from './finance-overview';
import type {
  FinanceProjectRef,
  OverviewFilters,
  OvertimeView,
  ReimbursementView,
} from '@/types/finance';

describe('overtimeMonth (cierre día 20)', () => {
  it('fecha con día <= 20 cuenta como su mes calendario', () => {
    expect(overtimeMonth('2026-06-20T00:00:00.000Z')).toBe('2026-06');
    expect(overtimeMonth('2026-06-01T00:00:00.000Z')).toBe('2026-06');
  });

  it('fecha con día > 20 cuenta como el mes siguiente', () => {
    expect(overtimeMonth('2026-06-21T00:00:00.000Z')).toBe('2026-07');
    expect(overtimeMonth('2026-06-30T00:00:00.000Z')).toBe('2026-07');
  });

  it('rollover de diciembre pasa a enero del año siguiente', () => {
    expect(overtimeMonth('2026-12-25T00:00:00.000Z')).toBe('2027-01');
  });
});

const reqA = { id: 'u1', firstName: 'Ana', lastName: 'Díaz', email: 'a@x.cl' };
const reqB = { id: 'u2', firstName: 'Beto', lastName: 'Ruiz', email: 'b@x.cl' };

const PROJECTS: FinanceProjectRef[] = [
  { id: 'p1', name: 'Alfa', clientId: 'c1', clientName: 'Cliente 1' },
  { id: 'p2', name: 'Beta', clientId: 'c2', clientName: 'Cliente 2' },
];

function reimb(over: Partial<ReimbursementView>): ReimbursementView {
  return {
    id: 'r1',
    userId: 'u1',
    amount: 1000,
    date: '2026-06-10T00:00:00.000Z',
    concept: 'Taxi',
    category: 'TRANSPORTE',
    subcategory: null,
    vehicle: null,
    observations: null,
    receiptUrl: null,
    rejectionReason: null,
    printed: false,
    printedAt: null,
    status: 'PENDIENTE',
    decidedById: null,
    decidedAt: null,
    createdAt: '',
    updatedAt: '',
    requester: reqA,
    ...over,
  };
}

function ot(over: Partial<OvertimeView>): OvertimeView {
  return {
    id: 'o1',
    userId: 'u1',
    date: '2026-06-10T00:00:00.000Z',
    hours: 2,
    totalHours: 12,
    regularHours: 10,
    shiftLabel: '08:00-18:00',
    weekendOrHoliday: false,
    reason: 'Cierre',
    startTime: '18:00',
    endTime: '20:00',
    isDraft: false,
    projectId: null,
    projectOther: null,
    authorizedById: null,
    onBehalfOfUserId: null,
    rejectionReason: null,
    status: 'PENDIENTE',
    decidedById: null,
    decidedAt: null,
    createdAt: '',
    updatedAt: '',
    requester: reqA,
    ...over,
  };
}

describe('toFinanceRows', () => {
  it('unifica reembolsos y HE en filas con kind y descripción', () => {
    const rows = toFinanceRows([reimb({})], [ot({})]);
    expect(rows).toHaveLength(2);
    const r = rows.find((x) => x.kind === 'REEMBOLSO')!;
    expect(r.amount).toBe(1000);
    expect(r.hours).toBeNull();
    expect(r.description).toBe('Taxi');
    const o = rows.find((x) => x.kind === 'HORA_EXTRA')!;
    expect(o.hours).toBe(2);
    expect(o.amount).toBeNull();
    expect(o.description).toBe('Cierre');
  });

  it('mapea el desglose de horas extra (inicio/fin, total, turno normal, turno del día)', () => {
    const rows = toFinanceRows(
      [reimb({})],
      [
        ot({
          startTime: '06:00',
          endTime: '18:00',
          hours: 2,
          totalHours: 12,
          regularHours: 10,
          shiftLabel: '08:00-18:00',
        }),
      ],
    );
    const o = rows.find((x) => x.kind === 'HORA_EXTRA')!;
    expect(o.startTime).toBe('06:00');
    expect(o.endTime).toBe('18:00');
    expect(o.totalHours).toBe(12);
    expect(o.regularHours).toBe(10);
    expect(o.shiftLabel).toBe('08:00-18:00');
    // El desglose no aplica a reembolsos.
    const r = rows.find((x) => x.kind === 'REEMBOLSO')!;
    expect(r.startTime).toBeNull();
    expect(r.endTime).toBeNull();
    expect(r.totalHours).toBeNull();
    expect(r.regularHours).toBeNull();
    expect(r.shiftLabel).toBeNull();
  });

  it('hidrata proyecto/cliente de la HE contra la lista de proyectos', () => {
    const rows = toFinanceRows([], [ot({ projectId: 'p1' })], PROJECTS);
    expect(rows[0]!.projectName).toBe('Alfa');
    expect(rows[0]!.clientId).toBe('c1');
    expect(rows[0]!.clientName).toBe('Cliente 1');
  });

  it('usa projectOther cuando la HE es "Otro"', () => {
    const rows = toFinanceRows([], [ot({ projectId: null, projectOther: 'Interno' })], PROJECTS);
    expect(rows[0]!.projectName).toBe('Interno');
  });

  it('sin requester cae a fallback pero conserva el userId', () => {
    const rows = toFinanceRows([reimb({ requester: undefined, userId: 'u9' })], []);
    expect(rows[0]!.requesterName).toBe('—');
    expect(rows[0]!.requesterId).toBe('u9');
  });
});

const base: OverviewFilters = {
  requesterId: null,
  dateMode: 'none',
  dateFrom: null,
  dateTo: null,
  month: null,
  projectId: null,
  clientId: null,
  order: 'desc',
};

describe('filterRows', () => {
  const rows = toFinanceRows(
    [
      reimb({ id: 'r1', date: '2026-06-10T00:00:00.000Z', requester: reqA }),
      reimb({ id: 'r2', date: '2026-06-25T00:00:00.000Z', requester: reqB }),
    ],
    [ot({ id: 'o1', date: '2026-07-02T00:00:00.000Z', requester: reqA, projectId: 'p1' })],
    PROJECTS,
  );

  it('filtra por trabajador', () => {
    const out = filterRows(rows, { ...base, requesterId: 'u2' });
    expect(out.map((r) => r.id)).toEqual(['r2']);
  });

  it('filtra por mes con cierre día 20 (r2 del 25-jun cae en julio)', () => {
    const out = filterRows(rows, { ...base, dateMode: 'month', month: '2026-07' });
    expect(out.map((r) => r.id).sort()).toEqual(['o1', 'r2']);
  });

  it('ordena por fecha ascendente', () => {
    const out = filterRows(rows, { ...base, order: 'asc' });
    expect(out.map((r) => r.id)).toEqual(['r1', 'r2', 'o1']);
  });

  it('filtra por rango entre dos fechas', () => {
    const out = filterRows(rows, {
      ...base,
      dateMode: 'between',
      dateFrom: '2026-06-20',
      dateTo: '2026-06-30',
    });
    expect(out.map((r) => r.id)).toEqual(['r2']);
  });

  it('filtro por proyecto solo excluye HE que no coinciden; nunca excluye reembolsos', () => {
    const out = filterRows(rows, { ...base, projectId: 'p2' });
    // r1, r2 (reembolsos) pasan siempre; o1 es de p1 → excluida.
    expect(out.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});

describe('aggregate', () => {
  it('cuenta HE pendientes (no borradores) y suma reembolsos APROBADOS (pend. de pago)', () => {
    const rows = toFinanceRows(
      [
        reimb({ id: 'r1', amount: 5000, status: 'APROBADO' }),
        reimb({ id: 'r2', amount: 3000, status: 'PENDIENTE' }),
      ],
      [
        ot({ id: 'o1', status: 'PENDIENTE' }),
        ot({ id: 'o2', status: 'APROBADO' }),
        ot({ id: 'o3', status: 'PENDIENTE', isDraft: true }),
      ],
    );
    const a = aggregate(rows);
    expect(a.overtimePendingCount).toBe(1); // o3 es borrador → no cuenta
    expect(a.overtimeApprovedCount).toBe(1);
    expect(a.reimbursementApprovedUnpaid).toBe(5000);
    expect(a.reimbursementPendingCount).toBe(1);
  });
});

describe('rankByWorker / rankByProject', () => {
  it('rankByWorker ordena por total de reembolso desc', () => {
    const rows = toFinanceRows(
      [
        reimb({ id: 'r1', amount: 1000, requester: reqA, status: 'APROBADO' }),
        reimb({ id: 'r2', amount: 9000, requester: reqB, status: 'APROBADO' }),
      ],
      [],
    );
    const rankw = rankByWorker(rows, 'reimbursement');
    expect(rankw[0]!.label).toBe('Beto Ruiz');
    expect(rankw[0]!.value).toBe(9000);
  });

  it('rankByProject suma horas de HE por proyecto desc', () => {
    const rows = toFinanceRows(
      [],
      [
        ot({ id: 'o1', hours: 2, projectId: 'p1' }),
        ot({ id: 'o2', hours: 2, projectId: 'p1' }),
        ot({ id: 'o3', hours: 2, projectId: 'p2' }),
      ],
      PROJECTS,
    );
    const rankp = rankByProject(rows, 'overtime');
    expect(rankp[0]!.label).toBe('Alfa');
    expect(rankp[0]!.value).toBe(4);
  });
});
