import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FinanceStatus } from '@prisma/client';
import type { Reimbursement } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import {
  ReimbursementsService,
  type UploadedReceiptFile,
} from '../../src/modules/reimbursements/reimbursements.service';

/** Fila Reimbursement (sin solicitante incluido) con overrides. */
function buildRow(overrides: Partial<Reimbursement> = {}): Reimbursement {
  const now = new Date('2026-06-14T00:00:00.000Z');
  return {
    id: 'r-1',
    userId: 'u1',
    amount: 15000,
    date: now,
    concept: 'Taxi al puerto',
    category: 'transporte',
    receiptUrl: null,
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
  overrides: Partial<Reimbursement> = {},
): Reimbursement & { user: { id: string; firstName: string; lastName: string; email: string } } {
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
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    create: parts.create ?? vi.fn(),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    update: parts.update ?? vi.fn(),
  };
  const prisma = { reimbursement: resolved } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

function buildStorage(): {
  storage: StorageService;
  save: ReturnType<typeof vi.fn>;
} {
  const save = vi.fn(() =>
    Promise.resolve({
      key: 'reimbursements/new.pdf',
      url: 'http://localhost:3001/files/reimbursements/new.pdf',
    }),
  );
  const del = vi.fn(() => Promise.resolve(undefined));
  return { storage: { save, delete: del } as unknown as StorageService, save };
}

function buildNotifications(): {
  notifications: NotificationsService;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(() => Promise.resolve(undefined));
  return { notifications: { create } as unknown as NotificationsService, create };
}

const RECEIPT: UploadedReceiptFile = {
  buffer: Buffer.from('pdf'),
  originalname: 'boleta.pdf',
  mimetype: 'application/pdf',
};

describe('ReimbursementsService', () => {
  let storageBits: ReturnType<typeof buildStorage>;
  let notifBits: ReturnType<typeof buildNotifications>;

  beforeEach(() => {
    storageBits = buildStorage();
    notifBits = buildNotifications();
  });

  function makeService(prisma: PrismaService): ReimbursementsService {
    return new ReimbursementsService(prisma, storageBits.storage, notifBits.notifications);
  }

  it('create crea un reembolso propio en estado PENDIENTE (userId de sesión)', async () => {
    const create = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'r-new' })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    const view = await service.create('u1', {
      amount: 15000,
      date: '2026-06-10T00:00:00.000Z',
      concept: 'Taxi',
      category: 'transporte',
    });

    const data = create.mock.calls[0]?.[0]?.data as {
      userId: string;
      status: FinanceStatus;
      amount: number;
    };
    expect(data.userId).toBe('u1');
    expect(data.status).toBe(FinanceStatus.PENDIENTE);
    expect(data.amount).toBe(15000);
    expect(view.status).toBe(FinanceStatus.PENDIENTE);
  });

  it('listMine filtra SOLO por el propio userId (más status opcional)', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listMine('u1', FinanceStatus.APROBADO);

    const where = findMany.mock.calls[0]?.[0]?.where as { userId: string; status: FinanceStatus };
    expect(where.userId).toBe('u1');
    expect(where.status).toBe(FinanceStatus.APROBADO);
  });

  it('listAll (gestor) aplica filtros e incluye al solicitante', async () => {
    const findMany = vi.fn(() => Promise.resolve([buildRowWithRequester()]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const views = await service.listAll({ status: FinanceStatus.PENDIENTE, userId: 'u9' });

    const call = findMany.mock.calls[0]?.[0] as {
      where: { status: FinanceStatus; userId: string };
      include: unknown;
    };
    expect(call.where.status).toBe(FinanceStatus.PENDIENTE);
    expect(call.where.userId).toBe('u9');
    expect(call.include).toBeDefined();
    expect(views[0]?.requester?.email).toBe('ana@gmt.cl');
  });

  it('getById: el dueño lo ve (sin requester)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRowWithRequester({ userId: 'owner' })));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    const view = await service.getById('r-1', 'owner', false);

    expect(view.id).toBe('r-1');
    expect(view.requester).toBeUndefined();
  });

  it('getById: un gestor lo ve aunque sea ajeno (con requester)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRowWithRequester({ userId: 'owner' })));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    const view = await service.getById('r-1', 'manager', true);

    expect(view.requester?.email).toBe('ana@gmt.cl');
  });

  it('getById: un ajeno no-gestor recibe 404', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRowWithRequester({ userId: 'owner' })));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    await expect(service.getById('r-1', 'intruso', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getById: inexistente → 404', async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    await expect(service.getById('nope', 'manager', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attachReceipt: solo el dueño + PENDIENTE sube boleta', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    const view = await service.attachReceipt('u1', 'r-1', RECEIPT);

    expect(storageBits.save).toHaveBeenCalledTimes(1);
    expect(storageBits.save.mock.calls[0]?.[0]).toMatchObject({ folder: 'reimbursements' });
    const data = update.mock.calls[0]?.[0]?.data as { receiptUrl: string };
    expect(data.receiptUrl).toBe('http://localhost:3001/files/reimbursements/new.pdf');
    expect(view.receiptUrl).toBe('http://localhost:3001/files/reimbursements/new.pdf');
  });

  it('attachReceipt: ajeno o inexistente → 404 y NO sube archivo', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findFirst });
    const service = makeService(prisma);

    await expect(service.attachReceipt('u1', 'ajeno', RECEIPT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storageBits.save).not.toHaveBeenCalled();
  });

  it('attachReceipt: reembolso ya resuelto (no PENDIENTE) → 409 y NO sube archivo', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.APROBADO })));
    const { prisma } = buildPrisma({ findFirst });
    const service = makeService(prisma);

    await expect(service.attachReceipt('u1', 'r-1', RECEIPT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storageBits.save).not.toHaveBeenCalled();
  });

  it('approve: PENDIENTE→APROBADO, fija decisor y notifica al solicitante', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data, userId: 'owner-1', concept: 'Taxi' })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    const view = await service.approve('mgr', 'r-1');

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
    expect(payload.type).toBe('reimbursement.decided');
    expect(payload.link).toBe('/finanzas/reembolsos');
    expect(payload.title).toContain('aprobado');
  });

  it('reject: PENDIENTE→RECHAZADO y notifica', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    const view = await service.reject('mgr', 'r-1', 'sin boleta');

    expect(view.status).toBe(FinanceStatus.RECHAZADO);
    expect(notifBits.create).toHaveBeenCalledTimes(1);
  });

  it('pay: APROBADO→PAGADO', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.APROBADO })));
    const update = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    const view = await service.pay('mgr', 'r-1');

    expect(view.status).toBe(FinanceStatus.PAGADO);
  });

  it('pay desde PENDIENTE → 409 (transición inválida) y NO actualiza ni notifica', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.pay('mgr', 'r-1')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
    expect(notifBits.create).not.toHaveBeenCalled();
  });

  it('approve sobre un reembolso ya APROBADO → 409 (no re-aprueba)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.APROBADO })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.approve('mgr', 'r-1')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('transición sobre inexistente → 404', async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findUnique });
    const service = makeService(prisma);

    await expect(service.approve('mgr', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reject con motivo → la notificación lo lleva en el body (promesa de la UI)', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow()));
    const update = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.RECHAZADO })));
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await service.reject('mgr', 'r-1', 'Falta la boleta del gasto.');

    expect(notifBits.create).toHaveBeenCalledTimes(1);
    const [toUserId, payload] = notifBits.create.mock.calls[0] as [
      string,
      { title: string; body?: string; link?: string },
    ];
    expect(toUserId).toBe('u1');
    expect(payload.body).toContain('Falta la boleta del gasto.');
    expect(payload.link).toBe('/finanzas/reembolsos');
  });

  it('reject sin motivo → notificación sin body', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow()));
    const update = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.RECHAZADO })));
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await service.reject('mgr', 'r-1');

    const [, payload] = notifBits.create.mock.calls[0] as [string, { body?: string }];
    expect(payload.body).toBeUndefined();
  });
});
