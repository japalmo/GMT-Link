import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FinanceStatus } from '@prisma/client';
import type { OvertimeRequest } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OvertimeService } from '../../src/modules/overtime/overtime.service';
import { startOfTodaySantiago } from '../../src/modules/finance/finance-time.util';

// Reloj fijo para toda la suite (solo `Date`): la ventana de la fecha de la HE
// ("todo el mes en curso, nada futuro") se calcula con `new Date()` dentro del
// servicio. Se fija a mediados de julio para que las fechas de prueba (días 3-13
// de julio) caigan dentro de la ventana de forma determinista, sin depender del
// mes real de ejecución. Mediodía UTC evita bordes de día.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-07-15T15:00:00.000Z'));

afterAll(() => {
  vi.useRealTimers();
});

/** Fila OvertimeRequest (sin solicitante) con overrides. */
function buildRow(overrides: Partial<OvertimeRequest> = {}): OvertimeRequest {
  const now = new Date('2026-07-10T00:00:00.000Z');
  return {
    id: 'o-1',
    userId: 'u1',
    date: now,
    startTime: '09:00',
    endTime: '11:30',
    hours: 2.5,
    totalHours: 2.5,
    shiftLabel: null,
    weekendOrHoliday: false,
    isDraft: false,
    reason: 'Cierre de informe',
    projectId: null,
    projectOther: null,
    authorizedById: null,
    onBehalfOfUserId: null,
    rejectionReason: null,
    status: FinanceStatus.PENDIENTE,
    decidedById: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Fila con el solicitante incluido (vistas de gestión). */
function buildRowWithRequester(
  overrides: Partial<OvertimeRequest> = {},
): OvertimeRequest & { user: { id: string; firstName: string; lastName: string; email: string } } {
  return {
    ...buildRow(overrides),
    user: { id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@gmt.cl' },
  };
}

interface PrismaParts {
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  /** workSchedule.findUnique del trabajador (para el desglose de horas extra). Default null. */
  workSchedule: ReturnType<typeof vi.fn>;
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    create: parts.create ?? vi.fn(),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    update: parts.update ?? vi.fn(),
    delete: parts.delete ?? vi.fn(),
    workSchedule: parts.workSchedule ?? vi.fn(() => Promise.resolve(null)),
  };
  const prisma = {
    overtimeRequest: resolved,
    workSchedule: { findUnique: resolved.workSchedule },
  } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

function buildNotifications(): {
  notifications: NotificationsService;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(() => Promise.resolve(undefined));
  return { notifications: { create } as unknown as NotificationsService, create };
}

describe('OvertimeService', () => {
  let notifBits: ReturnType<typeof buildNotifications>;

  beforeEach(() => {
    notifBits = buildNotifications();
  });

  function makeService(prisma: PrismaService): OvertimeService {
    return new OvertimeService(prisma, notifBits.notifications);
  }

  it('create crea una solicitud propia en estado PENDIENTE (userId de sesión)', async () => {
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'o-new' })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    const view = await service.create(
      'u1',
      { date: '2026-07-08T00:00:00.000Z', startTime: '09:00', endTime: '12:00' },
      true,
    );

    const data = create.mock.calls[0]?.[0]?.data as {
      userId: string;
      status: FinanceStatus;
      hours: number;
    };
    expect(data.userId).toBe('u1');
    expect(data.status).toBe(FinanceStatus.PENDIENTE);
    expect(data.hours).toBe(3);
    expect(view.status).toBe(FinanceStatus.PENDIENTE);
  });

  it('create descuenta el turno: 06:00-18:00 con turno 08:00-18:00 => hours=2 extra, total=12', async () => {
    // El caso reportado por la dueña: registra 06:00-18:00 un lunes; su turno ese día
    // es 08:00-18:00 => 2 h extra (06:00-08:00) y 10 h de turno normal.
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'o-new' })),
    );
    const workSchedule = vi.fn(() =>
      Promise.resolve({
        shiftPattern: 'ADMINISTRATIVO',
        workDays: null,
        restDays: null,
        cycleStart: null,
        startTime: '08:00',
        endTime: '18:00',
        weeklyHours: [{ weekday: 1, start: '08:00', end: '18:00' }],
      }),
    );
    const { prisma } = buildPrisma({ create, workSchedule });
    const service = makeService(prisma);

    await service.create(
      'felipe',
      { date: '2026-07-13T00:00:00.000Z', startTime: '06:00', endTime: '18:00' }, // 2026-07-13 lunes
      true,
    );

    expect(workSchedule).toHaveBeenCalledWith({ where: { userId: 'felipe' } });
    const data = create.mock.calls[0]?.[0]?.data as {
      hours: number;
      totalHours: number;
      shiftLabel: string;
    };
    expect(data.hours).toBe(2); // hora extra real
    expect(data.totalHours).toBe(12);
    expect(data.shiftLabel).toBe('08:00-18:00');
  });

  it('create sin permiso onBehalf: respeta la fecha elegida dentro del mes en curso (ya no la fuerza a hoy)', async () => {
    // Cambio "todo el mes en curso": cualquier trabajador puede elegir el día del
    // mes en que hizo la HE (antes, sin permiso onBehalf, la fecha se forzaba a hoy).
    // El permiso onBehalf ahora solo decide a nombre de QUIÉN, no la fecha.
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    // Un día del mes distinto de hoy (hoy = 15/07 en el reloj fijo) para probar que
    // NO se ancla al día de hoy.
    await service.create(
      'u1',
      { date: '2026-07-05T00:00:00.000Z', startTime: '09:00', endTime: '10:00' },
      false,
    );

    const savedDate = (create.mock.calls[0]?.[0]?.data as { date: Date }).date;
    expect(savedDate.toISOString()).toBe('2026-07-05T00:00:00.000Z');
    expect(savedDate.toISOString()).not.toBe(startOfTodaySantiago().toISOString());
  });

  it('create sin onBehalf: fecha anterior al mes en curso → 400 y NO inserta', async () => {
    const create = vi.fn();
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    const promise = service.create(
      'u1',
      { date: '2026-06-30T00:00:00.000Z', startTime: '09:00', endTime: '10:00' },
      false,
    );
    await expect(promise).rejects.toThrow('Solo puedes reportar horas extra del mes en curso.');
    expect(create).not.toHaveBeenCalled();
  });

  it('create sin onBehalf: fecha futura → 400 y NO inserta', async () => {
    const create = vi.fn();
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    const promise = service.create(
      'u1',
      { date: '2026-07-31T00:00:00.000Z', startTime: '09:00', endTime: '10:00' },
      false,
    );
    await expect(promise).rejects.toThrow('La fecha de la hora extra no puede ser futura.');
    expect(create).not.toHaveBeenCalled();
  });

  it('create con onBehalf: EXENTO de la ventana, puede fijar fecha de un mes anterior', async () => {
    // Decisión del dueño: los gestores con permiso onBehalf pueden cargar HE atrasada
    // (cualquier fecha), a diferencia del trabajador normal acotado al mes en curso.
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'o-backfill' })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    // 2026-05-03 está fuera del mes en curso (reloj fijo 15/07); con onBehalf debe pasar.
    await service.create(
      'admin-1',
      { date: '2026-05-03T00:00:00.000Z', startTime: '09:00', endTime: '11:00', onBehalfOfUserId: 'worker-9' },
      true,
    );

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0]?.data as { date: Date; userId: string };
    expect(data.date.toISOString()).toBe('2026-05-03T00:00:00.000Z');
    expect(data.userId).toBe('worker-9');
  });

  it('create con weekendOrHoliday=true: NO descuenta el turno, todo el periodo es HE', async () => {
    // Fin de semana/feriado: aunque el trabajador tenga turno ese día, no se descuenta;
    // todo el periodo trabajado entra como hora extra (shift=null en el cálculo).
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'o-finde' })),
    );
    const workSchedule = vi.fn(() =>
      Promise.resolve({
        shiftPattern: 'ADMINISTRATIVO',
        workDays: null,
        restDays: null,
        cycleStart: null,
        startTime: '08:00',
        endTime: '18:00',
        weeklyHours: [{ weekday: 1, start: '08:00', end: '18:00' }],
      }),
    );
    const { prisma } = buildPrisma({ create, workSchedule });
    const service = makeService(prisma);

    await service.create(
      'felipe',
      {
        date: '2026-07-13T00:00:00.000Z', // lunes con turno 08:00-18:00
        startTime: '08:00',
        endTime: '18:00',
        weekendOrHoliday: true,
      },
      true,
    );

    // No consulta el turno (se saltó por el flag) y todo el periodo es HE.
    expect(workSchedule).not.toHaveBeenCalled();
    const data = create.mock.calls[0]?.[0]?.data as {
      hours: number;
      totalHours: number;
      shiftLabel: string | null;
      weekendOrHoliday: boolean;
    };
    expect(data.hours).toBe(10); // 08:00-18:00 completo como hora extra
    expect(data.totalHours).toBe(10);
    expect(data.shiftLabel).toBeNull();
    expect(data.weekendOrHoliday).toBe(true);
  });

  it('create con permiso onBehalf y trabajador objetivo: userId=objetivo, onBehalfOfUserId=creador, respeta fecha', async () => {
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    await service.create(
      'admin-1',
      { date: '2026-07-03T00:00:00.000Z', startTime: '08:00', endTime: '10:00', onBehalfOfUserId: 'worker-9' },
      true,
    );

    const data = create.mock.calls[0]?.[0]?.data as {
      userId: string;
      onBehalfOfUserId: string | null;
      date: Date;
    };
    expect(data.userId).toBe('worker-9');
    expect(data.onBehalfOfUserId).toBe('admin-1');
    expect(data.date.toISOString()).toBe('2026-07-03T00:00:00.000Z');
  });

  it('create sin endTime => borrador (isDraft, hours null)', async () => {
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    await service.create('u1', { date: '2026-07-10T00:00:00.000Z', startTime: '09:00' }, false);

    const data = create.mock.calls[0]?.[0]?.data as { isDraft: boolean; hours: number | null };
    expect(data.isDraft).toBe(true);
    expect(data.hours).toBeNull();
  });

  it('create con endTime:null explícito => borrador (no revienta el cálculo)', async () => {
    // Un body de API con "endTime": null pasa la validación @IsOptional; debe tratarse
    // como borrador (== null), no colarse al cálculo y reventar en toMinutes.
    const create = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    const dto = { date: '2026-07-10T00:00:00.000Z', startTime: '09:00', endTime: null };
    await service.create('u1', dto as unknown as Parameters<typeof service.create>[1], false);

    const data = create.mock.calls[0]?.[0]?.data as { isDraft: boolean; hours: number | null };
    expect(data.isDraft).toBe(true);
    expect(data.hours).toBeNull();
  });

  it('close: respeta weekendOrHoliday del borrador (no descuenta turno; todo el periodo es HE)', async () => {
    // El flag se fija al crear el borrador y se conserva al cerrarlo: close() usa
    // current.weekendOrHoliday, así que NO consulta el turno y todo entra como HE.
    const findFirst = vi.fn(() =>
      Promise.resolve(
        buildRow({ isDraft: true, endTime: null, hours: null, startTime: '08:00', weekendOrHoliday: true }),
      ),
    );
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const workSchedule = vi.fn(() =>
      Promise.resolve({
        shiftPattern: 'ADMINISTRATIVO',
        workDays: null,
        restDays: null,
        cycleStart: null,
        startTime: '08:00',
        endTime: '18:00',
        weeklyHours: [{ weekday: 1, start: '08:00', end: '18:00' }],
      }),
    );
    const { prisma } = buildPrisma({ findFirst, update, workSchedule });
    const service = makeService(prisma);

    await service.close('u1', 'o-1', '18:00');

    expect(workSchedule).not.toHaveBeenCalled();
    const data = update.mock.calls[0]?.[0]?.data as {
      hours: number;
      totalHours: number;
      shiftLabel: string | null;
    };
    expect(data.hours).toBe(10); // 08:00-18:00 completo como hora extra
    expect(data.totalHours).toBe(10);
    expect(data.shiftLabel).toBeNull();
  });

  it('approve sobre borrador => 409', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ isDraft: true, endTime: null, hours: null })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.approve('mgr', 'o-1')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('close: fija endTime, computa horas y limpia el borrador', async () => {
    const findFirst = vi.fn(() =>
      Promise.resolve(buildRow({ isDraft: true, endTime: null, hours: null, startTime: '09:00' })),
    );
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    const view = await service.close('u1', 'o-1', '12:30');

    const data = update.mock.calls[0]?.[0]?.data as { endTime: string; hours: number; isDraft: boolean };
    expect(data.endTime).toBe('12:30');
    expect(data.hours).toBe(3.5);
    expect(data.isDraft).toBe(false);
    expect(view).toBeDefined();
  });

  it('update: recomputa hours/isDraft y persiste los campos editables', async () => {
    const findFirst = vi.fn(() =>
      Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE, startTime: '09:00' })),
    );
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    const view = await service.update('u1', 'o-1', {
      startTime: '08:00',
      endTime: '10:30',
      projectOther: 'Faena Norte',
      reason: 'Cierre mensual',
    });

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'o-1', userId: 'u1' } });
    const data = update.mock.calls[0]?.[0]?.data as {
      startTime: string;
      endTime: string | null;
      hours: number | null;
      isDraft: boolean;
      projectOther: string | null;
      reason: string | null;
    };
    expect(data.startTime).toBe('08:00');
    expect(data.endTime).toBe('10:30');
    expect(data.hours).toBe(2.5);
    expect(data.isDraft).toBe(false);
    expect(data.projectOther).toBe('Faena Norte');
    expect(data.reason).toBe('Cierre mensual');
    expect(view).toBeDefined();
  });

  it('update sin endTime => vuelve a borrador (isDraft, hours null)', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    await service.update('u1', 'o-1', { startTime: '09:00' });

    const data = update.mock.calls[0]?.[0]?.data as { isDraft: boolean; hours: number | null };
    expect(data.isDraft).toBe(true);
    expect(data.hours).toBeNull();
  });

  it('update de una solicitud ajena => 404 y no actualiza', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    await expect(
      service.update('intruso', 'o-1', { startTime: '09:00' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('update de una solicitud ya resuelta (no PENDIENTE) => 409 y no actualiza', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.APROBADO })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    await expect(
      service.update('u1', 'o-1', { startTime: '09:00' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('remove: elimina una solicitud propia PENDIENTE (hard delete por id)', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const del = vi.fn(() => Promise.resolve(buildRow()));
    const { prisma } = buildPrisma({ findFirst, delete: del });
    const service = makeService(prisma);

    await service.remove('u1', 'o-1');

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'o-1', userId: 'u1' } });
    expect(del).toHaveBeenCalledWith({ where: { id: 'o-1' } });
  });

  it('remove de una solicitud ajena => 404 y no borra', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const del = vi.fn();
    const { prisma } = buildPrisma({ findFirst, delete: del });
    const service = makeService(prisma);

    await expect(service.remove('intruso', 'o-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(del).not.toHaveBeenCalled();
  });

  it('remove de una solicitud ya resuelta (no PENDIENTE) => 409 y no borra', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PAGADO })));
    const del = vi.fn();
    const { prisma } = buildPrisma({ findFirst, delete: del });
    const service = makeService(prisma);

    await expect(service.remove('u1', 'o-1')).rejects.toBeInstanceOf(ConflictException);
    expect(del).not.toHaveBeenCalled();
  });

  it('reject persiste rejectionReason en la fila', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await service.reject('mgr', 'o-1', 'Fuera de horario permitido.');

    const data = update.mock.calls[0]?.[0]?.data as { rejectionReason?: string };
    expect(data.rejectionReason).toBe('Fuera de horario permitido.');
  });

  it('listAll aplica filtro de mes contable y orden por fecha', async () => {
    const findMany = vi.fn<
      (args: {
        where: { date?: { gte: Date; lt: Date }; projectId?: string };
        orderBy: Array<{ date?: string; id?: string }>;
      }) => Promise<never[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listAll({ month: '2026-07', order: 'asc', projectId: 'p1' });

    const call = findMany.mock.calls[0]?.[0];
    expect(call?.where.projectId).toBe('p1');
    expect(call?.where.date?.gte.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(call?.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }]);
  });

  it('listMine filtra SOLO por el propio userId (más status opcional)', async () => {
    const findMany = vi.fn<
      (args: { where: { userId: string; status?: FinanceStatus } }) => Promise<OvertimeRequest[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listMine('u1', { status: FinanceStatus.PAGADO });

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where?.userId).toBe('u1');
    expect(where?.status).toBe(FinanceStatus.PAGADO);
  });

  it('listMine: nextCursor=null cuando hay menos de limit+1 filas (orden createdAt desc + id desc, take=31)', async () => {
    const findMany = vi.fn(() => Promise.resolve([buildRow()]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const page = await service.listMine('u1');

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31 }),
    );
  });

  it('listMine: respeta el limit y calcula nextCursor (`createdAt_id`) trayendo limit+1 filas', async () => {
    const findMany = vi.fn(() =>
      Promise.resolve([
        buildRow({ id: 'o-1', createdAt: new Date('2026-06-14T00:00:03.000Z') }),
        buildRow({ id: 'o-2', createdAt: new Date('2026-06-14T00:00:02.000Z') }),
        buildRow({ id: 'o-3', createdAt: new Date('2026-06-14T00:00:01.000Z') }),
      ]),
    );
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const page = await service.listMine('u1', { limit: 2 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe('o-1');
    expect(page.nextCursor).toBe('2026-06-14T00:00:02.000Z_o-2');
  });

  it('listMine: tope el limit en 100 aunque se pida más', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listMine('u1', { limit: 5000 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });

  it('listAll (gestor) aplica filtros e incluye al solicitante', async () => {
    const findMany = vi.fn<
      (args: {
        where: { status?: FinanceStatus; userId?: string };
        include: unknown;
      }) => Promise<Array<ReturnType<typeof buildRowWithRequester>>>
    >(() => Promise.resolve([buildRowWithRequester()]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const page = await service.listAll({ status: FinanceStatus.PENDIENTE, userId: 'u9' });

    const call = findMany.mock.calls[0]?.[0];
    expect(call?.where.status).toBe(FinanceStatus.PENDIENTE);
    expect(call?.where.userId).toBe('u9');
    expect(call?.include).toBeDefined();
    expect(page.items[0]?.requester?.email).toBe('ana@gmt.cl');
  });

  it('listAll: respeta el limit y calcula nextCursor (`date_id`) trayendo limit+1 filas, orden desc por default', async () => {
    const findMany = vi.fn(() =>
      Promise.resolve([
        buildRowWithRequester({ id: 'o-1', date: new Date('2026-06-14T00:00:03.000Z') }),
        buildRowWithRequester({ id: 'o-2', date: new Date('2026-06-14T00:00:02.000Z') }),
        buildRowWithRequester({ id: 'o-3', date: new Date('2026-06-14T00:00:01.000Z') }),
      ]),
    );
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const page = await service.listAll({ limit: 2 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: [{ date: 'desc' }, { id: 'desc' }] }),
    );
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe('o-1');
    expect(page.nextCursor).toBe('2026-06-14T00:00:02.000Z_o-2');
  });

  it('listAll: keyset con cursor respeta la dirección de `order` (asc) en fecha e id', async () => {
    const findMany = vi.fn<
      (args: { where: { AND?: unknown }; orderBy: unknown }) => Promise<never[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listAll({ order: 'asc', cursor: '2026-06-14T00:00:02.000Z_o-2' });

    const call = findMany.mock.calls[0]?.[0] as { where: { AND?: unknown }; orderBy: unknown };
    expect(call.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }]);
    expect(call.where.AND).toEqual({
      OR: [
        { date: { gt: new Date('2026-06-14T00:00:02.000Z') } },
        { date: new Date('2026-06-14T00:00:02.000Z'), id: { gt: 'o-2' } },
      ],
    });
  });

  it('getById: el dueño lo ve (sin requester)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRowWithRequester({ userId: 'owner' })));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    const view = await service.getById('o-1', 'owner', false);

    expect(view.id).toBe('o-1');
    expect(view.requester).toBeUndefined();
  });

  it('getById: un gestor lo ve aunque sea ajeno (con requester)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRowWithRequester({ userId: 'owner' })));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    const view = await service.getById('o-1', 'manager', true);

    expect(view.requester?.email).toBe('ana@gmt.cl');
  });

  it('getById: un ajeno no-gestor recibe 404', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRowWithRequester({ userId: 'owner' })));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    await expect(service.getById('o-1', 'intruso', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getById: inexistente → 404', async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    await expect(service.getById('nope', 'manager', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approve: PENDIENTE→APROBADO, fija decisor y notifica al solicitante', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data, userId: 'owner-1' })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    const view = await service.approve('mgr', 'o-1');

    const data = update.mock.calls[0]?.[0]?.data as { status: FinanceStatus; decidedById: string };
    expect(data.status).toBe(FinanceStatus.APROBADO);
    expect(data.decidedById).toBe('mgr');
    expect(view.status).toBe(FinanceStatus.APROBADO);
    expect(notifBits.create).toHaveBeenCalledTimes(1);
    const [toUserId, payload] = notifBits.create.mock.calls[0] as [
      string,
      { type: string; link: string; title: string },
    ];
    expect(toUserId).toBe('owner-1');
    expect(payload.type).toBe('overtime.decided');
    // La ruta usa la clave real de la pestaña ('horas'), servida por /finanzas/:tab.
    expect(payload.link).toBe('/finanzas/horas');
    expect(payload.title).toContain('aprobado');
  });

  it('approve: rechaza aprobar las PROPIAS horas extra (maker-checker), sin update ni notificación', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(buildRow({ userId: 'mgr', status: FinanceStatus.PENDIENTE })),
    );
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.approve('mgr', 'o-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(notifBits.create).not.toHaveBeenCalled();
  });

  it('pay: rechaza registrar el pago de las PROPIAS horas extra (maker-checker), sin update ni notificación', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(buildRow({ userId: 'mgr', status: FinanceStatus.APROBADO })),
    );
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.pay('mgr', 'o-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(notifBits.create).not.toHaveBeenCalled();
  });

  it('reject: PENDIENTE→RECHAZADO y notifica', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    const view = await service.reject('mgr', 'o-1', 'no autorizado');

    expect(view.status).toBe(FinanceStatus.RECHAZADO);
    expect(notifBits.create).toHaveBeenCalledTimes(1);
  });

  it('pay: APROBADO→PAGADO', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.APROBADO })));
    const update = vi.fn((args: { data: Partial<OvertimeRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    const view = await service.pay('mgr', 'o-1');

    expect(view.status).toBe(FinanceStatus.PAGADO);
  });

  it('pay desde PENDIENTE → 409 (transición inválida) y NO actualiza ni notifica', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.pay('mgr', 'o-1')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
    expect(notifBits.create).not.toHaveBeenCalled();
  });

  it('reject sobre una solicitud ya RECHAZADA → 409', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.RECHAZADO })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.reject('mgr', 'o-1')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('transición sobre inexistente → 404', async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    await expect(service.approve('mgr', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reject con motivo → la notificación lo lleva en el body y el link apunta a la pestaña real', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow()));
    const update = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.RECHAZADO })));
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await service.reject('mgr', 'o-1', 'Las horas no corresponden al proyecto.');

    expect(notifBits.create).toHaveBeenCalledTimes(1);
    const [, payload] = notifBits.create.mock.calls[0] as [
      string,
      { title: string; body?: string; link?: string },
    ];
    expect(payload.body).toContain('Las horas no corresponden al proyecto.');
    expect(payload.link).toBe('/finanzas/horas');
  });

  it('summary: los rankings (trabajador y proyecto) filtran hours NOT NULL para no encabezar con solo-borradores', async () => {
    interface GroupByArgs {
      by: string[];
      where?: { hours?: unknown; projectId?: unknown };
    }
    // Un trabajador/proyecto con SOLO borradores tiene SUM(hours)=NULL; sin el
    // filtro `hours NOT NULL`, Postgres lo ordena NULLS FIRST (0h en la cima).
    const groupBy = vi.fn<(args: GroupByArgs) => Promise<unknown[]>>((args) => {
      if (args.by.includes('userId')) {
        return Promise.resolve([{ userId: 'u1', _sum: { hours: 5 } }]);
      }
      if (args.by.includes('projectId')) {
        return Promise.resolve([{ projectId: 'p1', _sum: { hours: 3 } }]);
      }
      return Promise.resolve([]); // statusGroups
    });
    const userFindMany = vi.fn(() => Promise.resolve([{ id: 'u1', firstName: 'Ana', lastName: 'Pérez' }]));
    const projectFindMany = vi.fn(() => Promise.resolve([{ id: 'p1', name: 'Proyecto 1' }]));
    const prisma = {
      overtimeRequest: { groupBy },
      user: { findMany: userFindMany },
      project: { findMany: projectFindMany },
    } as unknown as PrismaService;
    const service = makeService(prisma);

    const summary = await service.summary({});

    const workerCall = groupBy.mock.calls.find((c) => c[0].by.includes('userId'));
    const projectCall = groupBy.mock.calls.find((c) => c[0].by.includes('projectId'));
    expect(workerCall?.[0].where?.hours).toEqual({ not: null });
    expect(projectCall?.[0].where?.hours).toEqual({ not: null });
    expect(summary.rankingByWorker[0]).toEqual({ userId: 'u1', name: 'Ana Pérez', hours: 5 });
    expect(summary.byProject[0]).toEqual({ projectId: 'p1', name: 'Proyecto 1', hours: 3 });
  });
});
