import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FinanceStatus } from '@prisma/client';
import type { OvertimeRequest } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OvertimeService } from '../../src/modules/overtime/overtime.service';

/** Fila OvertimeRequest (sin solicitante) con overrides. */
function buildRow(overrides: Partial<OvertimeRequest> = {}): OvertimeRequest {
  const now = new Date('2026-06-14T00:00:00.000Z');
  return {
    id: 'o-1',
    userId: 'u1',
    date: now,
    hours: 2.5,
    reason: 'Cierre de informe',
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
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    create: parts.create ?? vi.fn(),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    update: parts.update ?? vi.fn(),
  };
  const prisma = { overtimeRequest: resolved } as unknown as PrismaService;
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

    const view = await service.create('u1', {
      date: '2026-06-10T00:00:00.000Z',
      hours: 3,
      reason: 'Terreno',
    });

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

  it('listMine filtra SOLO por el propio userId (más status opcional)', async () => {
    const findMany = vi.fn<
      (args: { where: { userId: string; status?: FinanceStatus } }) => Promise<OvertimeRequest[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listMine('u1', FinanceStatus.PAGADO);

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where?.userId).toBe('u1');
    expect(where?.status).toBe(FinanceStatus.PAGADO);
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

    const views = await service.listAll({ status: FinanceStatus.PENDIENTE, userId: 'u9' });

    const call = findMany.mock.calls[0]?.[0];
    expect(call?.where.status).toBe(FinanceStatus.PENDIENTE);
    expect(call?.where.userId).toBe('u9');
    expect(call?.include).toBeDefined();
    expect(views[0]?.requester?.email).toBe('ana@gmt.cl');
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
});
