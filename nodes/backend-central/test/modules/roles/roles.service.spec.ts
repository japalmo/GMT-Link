import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { FgaService } from '../../../src/fga/fga.service';
import { RolesService } from '../../../src/modules/roles/roles.service';

/** Fake mínimo de PrismaService: solo los métodos que RolesService usa. */
function makePrismaMock() {
  const mock = {
    permission: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    rolePermission: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    membership: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  // El callback de $transaction recibe el MISMO mock (auto-referencial): así
  // los asserts sobre role.update/deleteMany/createMany "dentro" de la
  // transacción (Task 2.8) se observan en este mismo objeto.
  mock.$transaction.mockImplementation(async (fn: (tx: typeof mock) => unknown) => fn(mock));
  return mock;
}

function makeFgaMock() {
  return {
    resyncRole: vi.fn(async () => undefined),
  };
}

describe('RolesService.listPermissions', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('agrupa por módulo y ordena: module asc; STRUCTURAL antes que FUNCTIONAL; alfabético por label (A14c)', async () => {
    // Entrada deliberadamente DESORDENADA: el orden de salida debe salir del código.
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:update', label: 'Mover / editar tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
      { key: 'user:create', label: 'Crear usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
      { key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
      { key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);

    const groups = await service.listPermissions();

    expect(groups).toEqual([
      {
        module: 'documentos',
        items: [
          {
            key: 'document:sign:qa',
            label: 'Firmar QA',
            module: 'documentos',
            kind: 'STRUCTURAL',
            scopeable: true,
            fgaObjectType: null,
            composable: false,
          },
        ],
      },
      {
        module: 'sistema',
        items: [
          {
            key: 'user:create',
            label: 'Crear usuarios',
            module: 'sistema',
            kind: 'FUNCTIONAL',
            scopeable: false,
            fgaObjectType: null,
            composable: true,
          },
        ],
      },
      {
        module: 'tareas',
        items: [
          // STRUCTURAL primero, alfabético por label:
          {
            key: 'task:assign',
            label: 'Asignar tareas',
            module: 'tareas',
            kind: 'STRUCTURAL',
            scopeable: true,
            fgaObjectType: 'project',
            composable: true,
          },
          {
            key: 'task:read',
            label: 'Ver tareas / backlog',
            module: 'tareas',
            kind: 'STRUCTURAL',
            scopeable: true,
            fgaObjectType: 'project',
            composable: true,
          },
          // FUNCTIONAL después:
          {
            key: 'task:update',
            label: 'Mover / editar tareas',
            module: 'tareas',
            kind: 'FUNCTIONAL',
            scopeable: true,
            fgaObjectType: null,
            composable: true,
          },
        ],
      },
    ]);
  });

  it('devuelve lista vacía si no hay permisos', async () => {
    prisma.permission.findMany.mockResolvedValue([]);
    const groups = await service.listPermissions();
    expect(groups).toEqual([]);
  });
});
