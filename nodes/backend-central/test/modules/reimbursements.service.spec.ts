import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
    subcategory: null,
    vehicle: null,
    observations: null,
    receiptUrl: null,
    receiptKey: null,
    rejectionReason: null,
    printed: false,
    printedAt: null,
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
  updateMany: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  geminiCount: ReturnType<typeof vi.fn>;
  geminiCreate: ReturnType<typeof vi.fn>;
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    create: parts.create ?? vi.fn(),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    update: parts.update ?? vi.fn(),
    updateMany: parts.updateMany ?? vi.fn(() => Promise.resolve({ count: 0 })),
    delete: parts.delete ?? vi.fn(() => Promise.resolve(undefined)),
    geminiCount: parts.geminiCount ?? vi.fn(() => Promise.resolve(0)),
    geminiCreate: parts.geminiCreate ?? vi.fn(() => Promise.resolve(undefined)),
  };
  const prisma = {
    reimbursement: {
      create: resolved.create,
      findMany: resolved.findMany,
      findFirst: resolved.findFirst,
      findUnique: resolved.findUnique,
      update: resolved.update,
      updateMany: resolved.updateMany,
      delete: resolved.delete,
    },
    geminiUsage: { count: resolved.geminiCount, create: resolved.geminiCreate },
  } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

function buildStorage(): {
  storage: StorageService;
  save: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const save = vi.fn(() =>
    Promise.resolve({
      key: 'reimbursements/new.pdf',
      url: 'http://localhost:3001/files/reimbursements/new.pdf',
    }),
  );
  const del = vi.fn(() => Promise.resolve(undefined));
  return { storage: { save, delete: del } as unknown as StorageService, save, del };
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
    const config = { get: vi.fn(() => undefined) } as unknown as import('@nestjs/config').ConfigService;
    return new ReimbursementsService(prisma, storageBits.storage, notifBits.notifications, config);
  }

  it('create crea un reembolso propio PENDIENTE con boleta obligatoria (userId de sesión)', async () => {
    const create = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'r-new' })),
    );
    const { prisma } = buildPrisma({ create });
    const service = makeService(prisma);

    const view = await service.create(
      'u1',
      {
        amount: 15000,
        date: '2026-06-10T00:00:00.000Z',
        concept: 'Taxi',
        category: 'transporte',
      },
      RECEIPT,
    );

    // La boleta se sube al storage (carpeta reimbursements) ANTES de insertar la fila.
    expect(storageBits.save).toHaveBeenCalledTimes(1);
    expect(storageBits.save.mock.calls[0]?.[0]).toMatchObject({ folder: 'reimbursements' });

    const data = create.mock.calls[0]?.[0]?.data as {
      userId: string;
      status: FinanceStatus;
      amount: number;
      receiptUrl: string;
      receiptKey: string;
    };
    expect(data.userId).toBe('u1');
    expect(data.status).toBe(FinanceStatus.PENDIENTE);
    expect(data.amount).toBe(15000);
    expect(data.receiptKey).toBe('reimbursements/new.pdf');
    expect(data.receiptUrl).toBe('http://localhost:3001/files/reimbursements/new.pdf');
    expect(view.status).toBe(FinanceStatus.PENDIENTE);
  });

  it('listMine filtra SOLO por el propio userId (más status opcional)', async () => {
    const findMany = vi.fn<
      (args: { where: { userId: string; status?: FinanceStatus } }) => Promise<Reimbursement[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listMine('u1', { status: FinanceStatus.APROBADO });

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where?.userId).toBe('u1');
    expect(where?.status).toBe(FinanceStatus.APROBADO);
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
        buildRow({ id: 'r-1', createdAt: new Date('2026-06-14T00:00:03.000Z') }),
        buildRow({ id: 'r-2', createdAt: new Date('2026-06-14T00:00:02.000Z') }),
        buildRow({ id: 'r-3', createdAt: new Date('2026-06-14T00:00:01.000Z') }),
      ]),
    );
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const page = await service.listMine('u1', { limit: 2 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe('r-1');
    expect(page.nextCursor).toBe('2026-06-14T00:00:02.000Z_r-2');
  });

  it('listMine: tope el limit en 100 aunque se pida más', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listMine('u1', { limit: 5000 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });

  it('listMine: keyset con cursor arma el OR desempatado por id', async () => {
    const findMany = vi.fn<(args: { where: { AND?: unknown } }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listMine('u1', { cursor: '2026-06-14T00:00:02.000Z_r-2' });

    const call = findMany.mock.calls[0]?.[0] as { where: { AND?: unknown } };
    expect(call.where.AND).toEqual({
      OR: [
        { createdAt: { lt: new Date('2026-06-14T00:00:02.000Z') } },
        { createdAt: new Date('2026-06-14T00:00:02.000Z'), id: { lt: 'r-2' } },
      ],
    });
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

  it('listAll: nextCursor=null cuando hay menos de limit+1 filas (take=31 por default)', async () => {
    const findMany = vi.fn(() => Promise.resolve([buildRowWithRequester()]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const page = await service.listAll({});

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 31 }));
  });

  it('listAll: respeta el limit y calcula nextCursor (`date_id`) trayendo limit+1 filas, orden desc por default', async () => {
    const findMany = vi.fn(() =>
      Promise.resolve([
        buildRowWithRequester({ id: 'r-1', date: new Date('2026-06-14T00:00:03.000Z') }),
        buildRowWithRequester({ id: 'r-2', date: new Date('2026-06-14T00:00:02.000Z') }),
        buildRowWithRequester({ id: 'r-3', date: new Date('2026-06-14T00:00:01.000Z') }),
      ]),
    );
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    const page = await service.listAll({ limit: 2 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: [{ date: 'desc' }, { id: 'desc' }] }),
    );
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe('r-1');
    expect(page.nextCursor).toBe('2026-06-14T00:00:02.000Z_r-2');
  });

  it('listAll: keyset con cursor respeta la dirección de `order` (asc) en fecha e id', async () => {
    const findMany = vi.fn<
      (args: { where: { AND?: unknown }; orderBy: unknown }) => Promise<never[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listAll({ order: 'asc', cursor: '2026-06-14T00:00:02.000Z_r-2' });

    const call = findMany.mock.calls[0]?.[0] as { where: { AND?: unknown }; orderBy: unknown };
    expect(call.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }]);
    expect(call.where.AND).toEqual({
      OR: [
        { date: { gt: new Date('2026-06-14T00:00:02.000Z') } },
        { date: new Date('2026-06-14T00:00:02.000Z'), id: { gt: 'r-2' } },
      ],
    });
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
    const data = update.mock.calls[0]?.[0]?.data as { receiptUrl: string; receiptKey: string };
    expect(data.receiptUrl).toBe('http://localhost:3001/files/reimbursements/new.pdf');
    expect(data.receiptKey).toBe('reimbursements/new.pdf');
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

  it('update: el dueño edita un reembolso PENDIENTE (campos editables, sin tocar la boleta)', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    const view = await service.update('u1', 'r-1', {
      amount: 20000,
      date: '2026-06-12T00:00:00.000Z',
      concept: 'Taxi de vuelta',
      category: 'transporte',
    });

    const data = update.mock.calls[0]?.[0]?.data as {
      amount: number;
      concept: string;
      category: string | null;
      subcategory: string | null;
      receiptUrl?: string;
      receiptKey?: string;
    };
    expect(data.amount).toBe(20000);
    expect(data.concept).toBe('Taxi de vuelta');
    expect(data.category).toBe('transporte');
    expect(data.subcategory).toBeNull();
    // La boleta NO se toca en un PUT.
    expect(data.receiptUrl).toBeUndefined();
    expect(data.receiptKey).toBeUndefined();
    expect(storageBits.save).not.toHaveBeenCalled();
    expect(view.amount).toBe(20000);
  });

  it('update: ajeno o inexistente → 404 y NO actualiza', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    await expect(
      service.update('u1', 'ajeno', {
        amount: 100,
        date: '2026-06-12T00:00:00.000Z',
        concept: 'X',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('update: reembolso ya resuelto (no PENDIENTE) → 409 y NO actualiza', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.APROBADO })));
    const update = vi.fn();
    const { prisma } = buildPrisma({ findFirst, update });
    const service = makeService(prisma);

    await expect(
      service.update('u1', 'r-1', {
        amount: 100,
        date: '2026-06-12T00:00:00.000Z',
        concept: 'X',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('remove: el dueño elimina un reembolso PENDIENTE (delete + borra la boleta del storage)', async () => {
    const findFirst = vi.fn(() =>
      Promise.resolve(
        buildRow({ status: FinanceStatus.PENDIENTE, receiptKey: 'reimbursements/boleta.pdf' }),
      ),
    );
    const del = vi.fn(() => Promise.resolve(undefined));
    const { prisma } = buildPrisma({ findFirst, delete: del });
    const service = makeService(prisma);

    await service.remove('u1', 'r-1');

    expect(del).toHaveBeenCalledWith({ where: { id: 'r-1' } });
    expect(storageBits.del).toHaveBeenCalledTimes(1);
    expect(storageBits.del).toHaveBeenCalledWith('reimbursements/boleta.pdf');
  });

  it('remove: ajeno o inexistente → 404 y NO borra fila ni boleta', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const del = vi.fn();
    const { prisma } = buildPrisma({ findFirst, delete: del });
    const service = makeService(prisma);

    await expect(service.remove('u1', 'ajeno')).rejects.toBeInstanceOf(NotFoundException);
    expect(del).not.toHaveBeenCalled();
    expect(storageBits.del).not.toHaveBeenCalled();
  });

  it('remove: reembolso ya resuelto (no PENDIENTE) → 409 y NO borra fila ni boleta', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PAGADO })));
    const del = vi.fn();
    const { prisma } = buildPrisma({ findFirst, delete: del });
    const service = makeService(prisma);

    await expect(service.remove('u1', 'r-1')).rejects.toBeInstanceOf(ConflictException);
    expect(del).not.toHaveBeenCalled();
    expect(storageBits.del).not.toHaveBeenCalled();
  });

  it('remove: si el borrado de la boleta en storage rechaza, igual resuelve (best-effort)', async () => {
    const findFirst = vi.fn(() =>
      Promise.resolve(
        buildRow({ status: FinanceStatus.PENDIENTE, receiptKey: 'reimbursements/boleta.pdf' }),
      ),
    );
    const del = vi.fn(() => Promise.resolve(undefined));
    const { prisma } = buildPrisma({ findFirst, delete: del });
    const service = makeService(prisma);
    storageBits.del.mockRejectedValueOnce(new Error('storage caído'));

    await expect(service.remove('u1', 'r-1')).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith({ where: { id: 'r-1' } });
    expect(storageBits.del).toHaveBeenCalledTimes(1);
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

  it('approve: rechaza aprobar el PROPIO reembolso (maker-checker), sin update ni notificación', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(buildRow({ userId: 'mgr', status: FinanceStatus.PENDIENTE })),
    );
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.approve('mgr', 'r-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(notifBits.create).not.toHaveBeenCalled();
  });

  it('pay: rechaza registrar el pago del PROPIO reembolso (maker-checker), sin update ni notificación', async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve(buildRow({ userId: 'mgr', status: FinanceStatus.APROBADO })),
    );
    const update = vi.fn();
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await expect(service.pay('mgr', 'r-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(notifBits.create).not.toHaveBeenCalled();
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

  it('reject persiste rejectionReason en la fila', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: FinanceStatus.PENDIENTE })));
    const update = vi.fn((args: { data: Partial<Reimbursement> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const service = makeService(prisma);

    await service.reject('mgr', 'r-1', 'Boleta ilegible.');

    const data = update.mock.calls[0]?.[0]?.data as { rejectionReason?: string };
    expect(data.rejectionReason).toBe('Boleta ilegible.');
  });

  it('listAll aplica filtro de mes contable y orden por fecha asc', async () => {
    const findMany = vi.fn<
      (args: {
        where: { date?: { gte: Date; lt: Date } };
        orderBy: Array<{ date?: string; id?: string }>;
      }) => Promise<never[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = makeService(prisma);

    await service.listAll({ month: '2026-07', order: 'asc' });

    const call = findMany.mock.calls[0]?.[0];
    expect(call?.where.date?.gte.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(call?.orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }]);
  });

  it('scanReceipt sin clave NVIDIA => objeto vacío y NO consume cuota', async () => {
    const geminiCreate = vi.fn(() => Promise.resolve(undefined));
    const { prisma } = buildPrisma({ geminiCreate });
    const service = makeService(prisma);
    await expect(service.scanReceipt('u1', 'data:image/jpeg;base64,AAAA')).resolves.toEqual({});
    expect(geminiCreate).not.toHaveBeenCalled();
  });

  it('scanReceipt cuenta la cuota diaria por el propio userId (tabla geminiUsage)', async () => {
    const geminiCount = vi.fn<
      (args: { where: { userId: string; createdAt: { gte: Date } } }) => Promise<number>
    >(() => Promise.resolve(0));
    const { prisma } = buildPrisma({ geminiCount });
    const service = makeService(prisma);

    await service.scanReceipt('u1', 'data:image/jpeg;base64,AAAA');

    const where = geminiCount.mock.calls[0]?.[0]?.where;
    expect(where?.userId).toBe('u1');
    expect(where?.createdAt.gte).toBeInstanceOf(Date);
  });

  it('scanReceipt supera el límite diario (>=3) => BadRequest y NO consume cuota', async () => {
    const geminiCount = vi.fn(() => Promise.resolve(3));
    const geminiCreate = vi.fn(() => Promise.resolve(undefined));
    const { prisma } = buildPrisma({ geminiCount, geminiCreate });
    const service = makeService(prisma);

    await expect(service.scanReceipt('u1', 'data:image/jpeg;base64,AAAA')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(geminiCreate).not.toHaveBeenCalled();
  });

  it('generateBatchPdf usa receiptKey y arma el PDF', async () => {
    const findMany = vi.fn(() =>
      Promise.resolve([
        buildRowWithRequester({ receiptKey: 'reimbursements/a.png', receiptUrl: 'https://r2/x?sig=1' }),
      ]),
    );
    const read = vi.fn(() =>
      Promise.resolve(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64',
        ),
      ),
    );
    const prisma = { reimbursement: { findMany } } as unknown as PrismaService;
    const storage = { save: vi.fn(), delete: vi.fn(), read } as unknown as StorageService;
    const config = { get: vi.fn(() => undefined) } as unknown as import('@nestjs/config').ConfigService;
    const service = new ReimbursementsService(prisma, storage, notifBits.notifications, config);

    const pdf = await service.generateBatchPdf(['r-1'], { perPage: 2 });
    expect(read).toHaveBeenCalledWith('reimbursements/a.png');
    expect(Buffer.from(pdf.slice(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('markPrinted marca impresas por id', async () => {
    const updateMany = vi.fn<
      (args: { where: { id: { in: string[] } }; data: { printed: boolean; printedAt: Date } }) => Promise<{ count: number }>
    >(() => Promise.resolve({ count: 2 }));
    const { prisma } = buildPrisma({ updateMany });
    const service = makeService(prisma);

    const res = await service.markPrinted(['a', 'b']);
    const call = updateMany.mock.calls[0]?.[0];
    expect(call?.data.printed).toBe(true);
    expect(res.marked).toBe(2);
  });
});
