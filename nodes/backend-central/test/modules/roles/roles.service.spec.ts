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

  it('ordena labels con colación es (localeCompare): "Árbol de tareas" antes que "Borrar tareas"', async () => {
    // Fija el contrato de colación: por codepoint 'Á' (U+00C1) > 'B' (U+0042)
    // invertiría el orden; localeCompare('es') trata 'Á' como 'A'.
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:delete', label: 'Borrar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { key: 'task:tree', label: 'Árbol de tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);

    const groups = await service.listPermissions();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.label)).toEqual(['Árbol de tareas', 'Borrar tareas']);
  });
});

describe('RolesService.createRole — validateGrants', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
    prisma.role.findMany.mockResolvedValue([]);
  });

  it('rechaza con 400 NOT_COMPOSABLE si un permiso no existe en el catálogo', async () => {
    prisma.permission.findMany.mockResolvedValue([]);

    await expect(
      service.createRole(
        { label: 'Demo', grants: [{ permissionKey: 'no:existe', scope: 'PROJECT' }] },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
  });

  it('rechaza con 400 NOT_COMPOSABLE si el permiso es STRUCTURAL fuera del mapa composable', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
    ]);

    await expect(
      service.createRole(
        { label: 'Demo', grants: [{ permissionKey: 'document:sign:qa', scope: 'PROJECT' }] },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
  });

  it('rechaza con 400 MIXED_SCOPE_LEVELS si mezcla STRUCTURAL org-level y project-level', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'finance:manage', label: 'Gestionar finanzas', module: 'finanzas', kind: 'STRUCTURAL', scopeable: false },
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);

    await expect(
      service.createRole(
        {
          label: 'Demo',
          grants: [
            { permissionKey: 'finance:manage', scope: 'GLOBAL' },
            { permissionKey: 'task:read', scope: 'PROJECT' },
          ],
        },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'MIXED_SCOPE_LEVELS' } });
  });

  it('acepta grants FUNCTIONAL + STRUCTURAL homogéneos (todos project-level)', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { key: 'task:update', label: 'Editar tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
    ]);
    prisma.role.create.mockResolvedValue({
      id: 'role_1', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
      { permission: { key: 'task:update' }, scope: 'PROJECT' },
    ]);

    const detail = await service.createRole(
      {
        label: 'Demo',
        grants: [
          { permissionKey: 'task:read', scope: 'PROJECT' },
          { permissionKey: 'task:update', scope: 'PROJECT' },
        ],
      },
      'user_1',
    );

    expect(detail.grants).toHaveLength(2);
  });

  it('acepta grants: [] — crea un rol vacío (A6)', async () => {
    prisma.permission.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue({
      id: 'role_1', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([]);

    const detail = await service.createRole({ label: 'Demo', grants: [] }, 'user_1');

    expect(detail.grants).toEqual([]);
    expect(detail.allowedScopeTypes).toEqual(['ORGANIZATION']);
  });

  it('rechaza scope no permitido para un permiso no scopeable (scopeable=false exige el scope declarado en catálogo, aquí GLOBAL)', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'finance:manage', label: 'Gestionar finanzas', module: 'finanzas', kind: 'STRUCTURAL', scopeable: false },
    ]);

    await expect(
      service.createRole(
        { label: 'Demo', grants: [{ permissionKey: 'finance:manage', scope: 'PROJECT' }] },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
  });
});

describe('RolesService.createRole — slugKey', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
    // Catálogo mínimo para que validateGrants (aún no implementado del todo) no falle en esta task:
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
  });

  it('genera key "c_"+slug en minúsculas sin acentos', async () => {
    prisma.role.findMany.mockResolvedValue([]); // sin colisión
    prisma.role.create.mockResolvedValue({
      id: 'role_1',
      key: 'c_supervisor_norte',
      label: 'Supervisor Norte',
      description: null,
      isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    const detail = await service.createRole(
      { label: 'Supervisor Norte', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }] },
      'user_admin_1',
    );

    expect(detail.key).toBe('c_supervisor_norte');
  });

  it('colapsa caracteres no [a-z0-9] a "_" y trunca a 40 chars', async () => {
    prisma.role.findMany.mockResolvedValue([]);
    let createdKey = '';
    prisma.role.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      createdKey = data.key;
      return { id: 'role_2', key: data.key, label: 'x', description: null, isSystem: false };
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    await service.createRole(
      {
        label: 'Ñoño!! Supervisor  de   Zona--Muy-Larga-Que-Excede-Los-Cuarenta-Caracteres',
        grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
      },
      'user_admin_1',
    );

    expect(createdKey.startsWith('c_')).toBe(true);
    expect(createdKey.length).toBeLessThanOrEqual(40);
    expect(createdKey).not.toMatch(/[^a-z0-9_]/);
    expect(createdKey).not.toMatch(/__/);
  });

  it('usa fallback "rol" si el label es solo símbolos (slug vacío): "!!!" → key "c_rol"', async () => {
    prisma.role.findMany.mockResolvedValue([]);
    let createdKey = '';
    prisma.role.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      createdKey = data.key;
      return { id: 'role_4', key: data.key, label: '!!!', description: null, isSystem: false };
    });
    prisma.rolePermission.findMany.mockResolvedValue([]);

    await service.createRole({ label: '!!!', grants: [] }, 'user_admin_1');

    expect(createdKey).toBe('c_rol');
  });

  it('agrega sufijo _2 si el slug colisiona con un rol existente', async () => {
    prisma.role.findMany.mockResolvedValue([{ key: 'c_supervisor_norte' }]);
    let createdKey = '';
    prisma.role.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      createdKey = data.key;
      return { id: 'role_3', key: data.key, label: 'x', description: null, isSystem: false };
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    await service.createRole(
      { label: 'Supervisor Norte', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }] },
      'user_admin_1',
    );

    expect(createdKey).toBe('c_supervisor_norte_2');
  });
});
