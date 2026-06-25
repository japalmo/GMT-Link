import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';

/** Construye una fila Notification completa con overrides. */
function buildRow(overrides: Partial<Notification> = {}): Notification {
  const now = new Date('2026-06-14T00:00:00.000Z');
  return {
    id: 'n1',
    userId: 'u1',
    type: 'document.reviewed',
    title: 'Tu documento fue aprobado',
    body: null,
    link: '/perfil/documentos',
    readAt: null,
    createdAt: now,
    ...overrides,
  };
}

interface PrismaParts {
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  /** `userPreferences.findUnique` del DESTINATARIO (gating de notifyInApp). */
  prefsFindUnique: ReturnType<typeof vi.fn>;
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    create: parts.create ?? vi.fn(),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),
    update: parts.update ?? vi.fn(),
    updateMany: parts.updateMany ?? vi.fn(() => Promise.resolve({ count: 0 })),
    count: parts.count ?? vi.fn(() => Promise.resolve(0)),
    // Default: sin preferencias guardadas → notifyInApp default true (se crea).
    prefsFindUnique: parts.prefsFindUnique ?? vi.fn(() => Promise.resolve(null)),
  };
  const prisma = {
    notification: resolved,
    userPreferences: { findUnique: resolved.prefsFindUnique },
  } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

describe('NotificationsService', () => {
  let prismaBits: ReturnType<typeof buildPrisma>;
  let service: NotificationsService;

  beforeEach(() => {
    prismaBits = buildPrisma();
    service = new NotificationsService(prismaBits.prisma);
  });

  it('create persiste el destinatario y normaliza body/link ausentes a null', async () => {
    const create = vi.fn((args: { data: Partial<Notification> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    ({ prisma: prismaBits.prisma } = buildPrisma({ create }));
    service = new NotificationsService(prismaBits.prisma);

    const view = await service.create('owner-1', { type: 'document.reviewed', title: 'Aprobado' });

    const data = create.mock.calls[0]?.[0]?.data as {
      userId: string;
      type: string;
      title: string;
      body: string | null;
      link: string | null;
    };
    expect(data.userId).toBe('owner-1');
    expect(data.type).toBe('document.reviewed');
    expect(data.body).toBeNull();
    expect(data.link).toBeNull();
    expect(view?.type).toBe('document.reviewed');
  });

  it('create SIN preferencias del destinatario usa default true: crea la notificación', async () => {
    const create = vi.fn((args: { data: Partial<Notification> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    // prefsFindUnique default → null (sin preferencias).
    ({ prisma: prismaBits.prisma } = buildPrisma({ create }));
    service = new NotificationsService(prismaBits.prisma);

    const view = await service.create('owner-1', { type: 'x', title: 'Hola' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(view).not.toBeNull();
  });

  it('create respeta notifyInApp=false del destinatario: NO inserta y retorna null', async () => {
    const create = vi.fn();
    const prefsFindUnique = vi.fn(() => Promise.resolve({ notifyInApp: false }));
    ({ prisma: prismaBits.prisma } = buildPrisma({ create, prefsFindUnique }));
    service = new NotificationsService(prismaBits.prisma);

    const view = await service.create('owner-1', { type: 'x', title: 'Hola' });

    expect(view).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(prefsFindUnique.mock.calls[0]?.[0]?.where).toEqual({ userId: 'owner-1' });
  });

  it('create con notifyInApp=true del destinatario sí inserta', async () => {
    const create = vi.fn((args: { data: Partial<Notification> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const prefsFindUnique = vi.fn(() => Promise.resolve({ notifyInApp: true }));
    ({ prisma: prismaBits.prisma } = buildPrisma({ create, prefsFindUnique }));
    service = new NotificationsService(prismaBits.prisma);

    const view = await service.create('owner-1', { type: 'x', title: 'Hola' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(view).not.toBeNull();
  });

  it('listMine (todas) filtra por userId y ordena createdAt desc', async () => {
    const findMany = vi.fn(() => Promise.resolve([buildRow()]));
    ({ prisma: prismaBits.prisma } = buildPrisma({ findMany }));
    service = new NotificationsService(prismaBits.prisma);

    await service.listMine('u1', false);

    const args = findMany.mock.calls[0]?.[0] as {
      where: { userId: string; readAt?: null };
      orderBy: { createdAt: string };
    };
    expect(args.where).toEqual({ userId: 'u1' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('listMine con unreadOnly filtra readAt null', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    ({ prisma: prismaBits.prisma } = buildPrisma({ findMany }));
    service = new NotificationsService(prismaBits.prisma);

    await service.listMine('u1', true);

    const where = findMany.mock.calls[0]?.[0]?.where as { userId: string; readAt: null };
    expect(where).toEqual({ userId: 'u1', readAt: null });
  });

  it('unreadCount cuenta solo no leídas del usuario', async () => {
    const count = vi.fn(() => Promise.resolve(3));
    ({ prisma: prismaBits.prisma } = buildPrisma({ count }));
    service = new NotificationsService(prismaBits.prisma);

    const result = await service.unreadCount('u1');

    expect(result).toEqual({ count: 3 });
    expect(count.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1', readAt: null });
  });

  it('markRead marca la propia no leída con readAt', async () => {
    const findFirst = vi.fn(() => Promise.resolve(buildRow({ readAt: null })));
    const update = vi.fn((args: { data: { readAt: Date } }) =>
      Promise.resolve(buildRow({ readAt: args.data.readAt })),
    );
    ({ prisma: prismaBits.prisma } = buildPrisma({ findFirst, update }));
    service = new NotificationsService(prismaBits.prisma);

    const view = await service.markRead('u1', 'n1');

    expect(findFirst.mock.calls[0]?.[0]?.where).toEqual({ id: 'n1', userId: 'u1' });
    expect(update.mock.calls[0]?.[0]?.data?.readAt).toBeInstanceOf(Date);
    expect(view.readAt).not.toBeNull();
  });

  it('markRead sobre una notificación AJENA o inexistente lanza 404 y no actualiza', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const update = vi.fn();
    ({ prisma: prismaBits.prisma } = buildPrisma({ findFirst, update }));
    service = new NotificationsService(prismaBits.prisma);

    await expect(service.markRead('u1', 'ajena')).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('markRead es idempotente: una ya leída no se vuelve a actualizar', async () => {
    const already = buildRow({ readAt: new Date('2026-06-13T00:00:00.000Z') });
    const findFirst = vi.fn(() => Promise.resolve(already));
    const update = vi.fn();
    ({ prisma: prismaBits.prisma } = buildPrisma({ findFirst, update }));
    service = new NotificationsService(prismaBits.prisma);

    const view = await service.markRead('u1', 'n1');

    expect(update).not.toHaveBeenCalled();
    expect(view.readAt).toBe('2026-06-13T00:00:00.000Z');
  });

  it('markAllRead actualiza solo las no leídas del usuario y retorna updated', async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 5 }));
    ({ prisma: prismaBits.prisma } = buildPrisma({ updateMany }));
    service = new NotificationsService(prismaBits.prisma);

    const result = await service.markAllRead('u1');

    expect(result).toEqual({ updated: 5 });
    const args = updateMany.mock.calls[0]?.[0] as {
      where: { userId: string; readAt: null };
      data: { readAt: Date };
    };
    expect(args.where).toEqual({ userId: 'u1', readAt: null });
    expect(args.data.readAt).toBeInstanceOf(Date);
  });
});
