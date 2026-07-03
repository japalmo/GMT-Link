import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PermissionRequest } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ORG_ID } from '../../src/common/org.constant';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { UsersService } from '../../src/modules/users/users.service';
import { PermissionRequestsService } from '../../src/modules/permission-requests/permission-requests.service';

/** Construye una fila PermissionRequest completa con overrides. */
function buildRow(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'req-1',
    userId: 'u1',
    roleKey: 'operator',
    scopeType: 'ORGANIZATION',
    scopeId: ORG_ID,
    reason: null,
    status: 'PENDIENTE',
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Catálogo simulado de la tabla `Role` (Task 3.10, matriz RBAC dinámica): la
 * validación del roleKey es por EXISTENCIA en BD — incluye roles personalizados
 * `c_xxx` — no contra la lista estática `ROLE_KEYS`/`isRoleKey`.
 */
const CATALOG_ROLE_KEYS: ReadonlySet<string> = new Set([
  'operator',
  'qa',
  'finance',
  'c_inspector',
]);

interface PrismaParts {
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  /** `prisma.role.findUnique` (existencia del rol en el catálogo). */
  roleFindUnique: ReturnType<typeof vi.fn>;
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    create: parts.create ?? vi.fn((args: { data: Partial<PermissionRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    ),
    update: parts.update ?? vi.fn((args: { data: Partial<PermissionRequest> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    ),
    roleFindUnique:
      parts.roleFindUnique ??
      vi.fn((args: { where: { key: string } }) =>
        Promise.resolve(CATALOG_ROLE_KEYS.has(args.where.key) ? { key: args.where.key } : null),
      ),
  };
  const prisma = {
    permissionRequest: {
      findFirst: resolved.findFirst,
      findUnique: resolved.findUnique,
      findMany: resolved.findMany,
      create: resolved.create,
      update: resolved.update,
    },
    role: { findUnique: resolved.roleFindUnique },
  } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

function buildUsers(
  assignRole: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve({ id: 'u1', roleKeys: [] })),
): { users: UsersService; assignRole: ReturnType<typeof vi.fn> } {
  return { users: { assignRole } as unknown as UsersService, assignRole };
}

function buildNotifications(): {
  notifications: NotificationsService;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(() => Promise.resolve(null));
  return { notifications: { create } as unknown as NotificationsService, create };
}

describe('PermissionRequestsService.create', () => {
  it('crea una solicitud propia con scope ORGANIZATION/ORG_ID y status PENDIENTE', async () => {
    const { prisma, parts } = buildPrisma();
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    const view = await service.create('u1', { roleKey: 'operator', reason: 'necesito acceso' });

    const data = parts.create.mock.calls[0]?.[0]?.data as Partial<PermissionRequest>;
    expect(data.userId).toBe('u1');
    expect(data.roleKey).toBe('operator');
    expect(data.scopeType).toBe('ORGANIZATION');
    expect(data.scopeId).toBe(ORG_ID);
    expect(data.status).toBe('PENDIENTE');
    expect(data.reason).toBe('necesito acceso');
    expect(view.status).toBe('PENDIENTE');
  });

  it('acepta un rol dinámico c_xxx que existe en la tabla Role y crea la solicitud', async () => {
    const { prisma, parts } = buildPrisma();
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    const view = await service.create('u1', { roleKey: 'c_inspector' });

    // La existencia se consulta contra la tabla Role (no contra ROLE_KEYS estáticos).
    expect(parts.roleFindUnique).toHaveBeenCalledTimes(1);
    const roleArgs = parts.roleFindUnique.mock.calls[0]?.[0] as { where: { key: string } };
    expect(roleArgs.where).toEqual({ key: 'c_inspector' });
    const data = parts.create.mock.calls[0]?.[0]?.data as Partial<PermissionRequest>;
    expect(data.roleKey).toBe('c_inspector');
    expect(view.roleKey).toBe('c_inspector');
  });

  it('400 nombrando el rol si el roleKey no existe en la tabla Role, y no escribe', async () => {
    const { prisma, parts } = buildPrisma();
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    await expect(service.create('u1', { roleKey: 'no_existe' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create('u1', { roleKey: 'no_existe' })).rejects.toThrow(
      'El rol "no_existe" no existe en el catálogo.',
    );
    expect(parts.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 un roleKey desconocido y no escribe', async () => {
    const { prisma, parts } = buildPrisma();
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    await expect(service.create('u1', { roleKey: 'no-existe' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(parts.create).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si ya hay una PENDIENTE del mismo usuario+roleKey', async () => {
    const findFirst = vi.fn<
      (args: { where: Record<string, unknown> }) => Promise<PermissionRequest | null>
    >(() => Promise.resolve(buildRow()));
    const { prisma, parts } = buildPrisma({ findFirst });
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    await expect(service.create('u1', { roleKey: 'operator' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    const where = findFirst.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ userId: 'u1', roleKey: 'operator', status: 'PENDIENTE' });
    expect(parts.create).not.toHaveBeenCalled();
  });
});

describe('PermissionRequestsService.approve', () => {
  it('marca APROBADA + decidedBy/At, llama assignRole y notifica al solicitante', async () => {
    const pending = buildRow({ id: 'req-1', userId: 'u1', roleKey: 'finance' });
    const findUnique = vi.fn(() => Promise.resolve(pending));
    const update = vi.fn((args: { data: Partial<PermissionRequest> }) =>
      Promise.resolve(buildRow({ ...pending, ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const usersBits = buildUsers();
    const notifBits = buildNotifications();
    const service = new PermissionRequestsService(prisma, usersBits.users, notifBits.notifications);

    const view = await service.approve('admin-1', 'req-1');

    // Aplica el rol al SOLICITANTE (no al admin).
    expect(usersBits.assignRole).toHaveBeenCalledWith('u1', 'finance');
    const data = update.mock.calls[0]?.[0]?.data as Partial<PermissionRequest>;
    expect(data.status).toBe('APROBADA');
    expect(data.decidedById).toBe('admin-1');
    expect(data.decidedAt).toBeInstanceOf(Date);
    // Notifica al solicitante (u1), no al admin.
    expect(notifBits.create).toHaveBeenCalledTimes(1);
    expect(notifBits.create.mock.calls[0]?.[0]).toBe('u1');
    const payload = notifBits.create.mock.calls[0]?.[1] as { type: string; link: string };
    expect(payload.type).toBe('permission.request.resolved');
    expect(payload.link).toBe('/configuracion');
    expect(view.status).toBe('APROBADA');
  });

  it('si assignRole lanza 409 (ya tiene el rol) IGUAL marca APROBADA y notifica', async () => {
    const pending = buildRow();
    const findUnique = vi.fn(() => Promise.resolve(pending));
    const update = vi.fn((args: { data: Partial<PermissionRequest> }) =>
      Promise.resolve(buildRow({ ...pending, ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const assignRole = vi.fn(() => Promise.reject(new ConflictException('ya lo tiene')));
    const usersBits = buildUsers(assignRole);
    const notifBits = buildNotifications();
    const service = new PermissionRequestsService(prisma, usersBits.users, notifBits.notifications);

    const view = await service.approve('admin-1', 'req-1');

    expect(view.status).toBe('APROBADA');
    expect(update).toHaveBeenCalledTimes(1);
    expect(notifBits.create).toHaveBeenCalledTimes(1);
  });

  it('si assignRole lanza un error NO-conflicto, propaga y no marca decidida', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow()));
    const { prisma, parts } = buildPrisma({ findUnique });
    const assignRole = vi.fn(() => Promise.reject(new Error('FGA caído')));
    const usersBits = buildUsers(assignRole);
    const notifBits = buildNotifications();
    const service = new PermissionRequestsService(prisma, usersBits.users, notifBits.notifications);

    await expect(service.approve('admin-1', 'req-1')).rejects.toThrow('FGA caído');
    expect(parts.update).not.toHaveBeenCalled();
    expect(notifBits.create).not.toHaveBeenCalled();
  });

  it('404 si la solicitud no existe', async () => {
    const findUnique = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findUnique });
    const usersBits = buildUsers();
    const service = new PermissionRequestsService(
      prisma,
      usersBits.users,
      buildNotifications().notifications,
    );

    await expect(service.approve('admin-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(usersBits.assignRole).not.toHaveBeenCalled();
  });

  it('409 si la solicitud ya fue resuelta (no PENDIENTE) y no llama assignRole', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: 'APROBADA' })));
    const { prisma } = buildPrisma({ findUnique });
    const usersBits = buildUsers();
    const service = new PermissionRequestsService(
      prisma,
      usersBits.users,
      buildNotifications().notifications,
    );

    await expect(service.approve('admin-1', 'req-1')).rejects.toBeInstanceOf(ConflictException);
    expect(usersBits.assignRole).not.toHaveBeenCalled();
  });
});

describe('PermissionRequestsService.reject', () => {
  it('marca RECHAZADA + decidedBy/At, persiste reason y notifica al solicitante', async () => {
    const pending = buildRow({ userId: 'u9', roleKey: 'qa' });
    const findUnique = vi.fn(() => Promise.resolve(pending));
    const update = vi.fn((args: { data: Partial<PermissionRequest> }) =>
      Promise.resolve(buildRow({ ...pending, ...args.data })),
    );
    const { prisma } = buildPrisma({ findUnique, update });
    const notifBits = buildNotifications();
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      notifBits.notifications,
    );

    const view = await service.reject('admin-1', 'req-1', 'sin justificación');

    const data = update.mock.calls[0]?.[0]?.data as Partial<PermissionRequest>;
    expect(data.status).toBe('RECHAZADA');
    expect(data.decidedById).toBe('admin-1');
    expect(data.decidedAt).toBeInstanceOf(Date);
    expect(data.reason).toBe('sin justificación');
    expect(notifBits.create).toHaveBeenCalledTimes(1);
    expect(notifBits.create.mock.calls[0]?.[0]).toBe('u9');
    expect(view.status).toBe('RECHAZADA');
  });

  it('409 si no está PENDIENTE', async () => {
    const findUnique = vi.fn(() => Promise.resolve(buildRow({ status: 'RECHAZADA' })));
    const { prisma, parts } = buildPrisma({ findUnique });
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    await expect(service.reject('admin-1', 'req-1')).rejects.toBeInstanceOf(ConflictException);
    expect(parts.update).not.toHaveBeenCalled();
  });
});

describe('PermissionRequestsService.listMine / listPending', () => {
  it('listMine filtra por userId y ordena createdAt desc', async () => {
    const findMany = vi.fn<
      (args: {
        where: { userId: string };
        orderBy: { createdAt: string };
      }) => Promise<PermissionRequest[]>
    >(() => Promise.resolve([buildRow()]));
    const { prisma } = buildPrisma({ findMany });
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    await service.listMine('u1');

    const args = findMany.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ userId: 'u1' });
    expect(args?.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('listPending filtra status PENDIENTE, incluye al solicitante y lo expone en la vista', async () => {
    const rowWithUser = {
      ...buildRow({ userId: 'u7' }),
      user: { id: 'u7', firstName: 'Ana', lastName: 'Pérez', email: 'ana@gmt.cl' },
    };
    const findMany = vi.fn<
      (args: { where: { status: string }; include: unknown }) => Promise<(typeof rowWithUser)[]>
    >(() => Promise.resolve([rowWithUser]));
    const { prisma } = buildPrisma({ findMany });
    const service = new PermissionRequestsService(
      prisma,
      buildUsers().users,
      buildNotifications().notifications,
    );

    const result = await service.listPending();

    const args = findMany.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ status: 'PENDIENTE' });
    expect(args?.include).toBeDefined();
    expect(result[0]?.requester).toEqual({
      id: 'u7',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@gmt.cl',
    });
  });
});
