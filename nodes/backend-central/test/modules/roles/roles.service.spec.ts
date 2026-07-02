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

  it('rechaza con 400 DUPLICATE_GRANT si la misma permissionKey aparece dos veces (mismo scope)', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);

    await expect(
      service.createRole(
        {
          label: 'Demo',
          grants: [
            { permissionKey: 'task:read', scope: 'PROJECT' },
            { permissionKey: 'task:read', scope: 'PROJECT' },
          ],
        },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'DUPLICATE_GRANT' } });
  });

  it('rechaza con 400 DUPLICATE_GRANT si la misma permissionKey aparece con scopes distintos (contradicción visible, no dedupe silencioso)', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);

    await expect(
      service.createRole(
        {
          label: 'Demo',
          grants: [
            { permissionKey: 'task:read', scope: 'PROJECT' },
            { permissionKey: 'task:read', scope: 'OWN' },
          ],
        },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'DUPLICATE_GRANT' } });
  });

  it('acepta mezcla FUNCTIONAL + STRUCTURAL org-level (homogéneo organization)', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'finance:manage', label: 'Gestionar finanzas', module: 'finanzas', kind: 'STRUCTURAL', scopeable: false },
      { key: 'task:update', label: 'Editar tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
    ]);
    prisma.role.create.mockResolvedValue({
      id: 'role_1', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'finance:manage' }, scope: 'GLOBAL' },
      { permission: { key: 'task:update' }, scope: 'PROJECT' },
    ]);

    const detail = await service.createRole(
      {
        label: 'Demo',
        grants: [
          { permissionKey: 'finance:manage', scope: 'GLOBAL' },
          { permissionKey: 'task:update', scope: 'PROJECT' },
        ],
      },
      'user_1',
    );

    expect(detail.grants).toHaveLength(2);
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

describe('RolesService.listRoles / getRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('listRoles devuelve todos los roles con sus grants en UNA query (join, sin N+1)', async () => {
    prisma.role.findMany.mockResolvedValue([
      {
        id: 'role_1', key: 'org_admin', label: 'Admin', description: null, isSystem: true,
        permissions: [{ permission: { key: 'user:create' }, scope: 'GLOBAL' }],
      },
      {
        id: 'role_2', key: 'c_demo', label: 'Demo', description: 'custom', isSystem: false,
        permissions: [{ permission: { key: 'task:read' }, scope: 'PROJECT' }],
      },
    ]);

    const roles = await service.listRoles();

    expect(roles).toHaveLength(2);
    expect(roles[0]).toMatchObject({
      key: 'org_admin',
      isSystem: true,
      grants: [{ permissionKey: 'user:create', scope: 'GLOBAL' }],
    });
    expect(roles[1]).toMatchObject({ key: 'c_demo', isSystem: false, description: 'custom' });
    // Una sola query con include: no debe haber una consulta de grants por rol.
    expect(prisma.rolePermission.findMany).not.toHaveBeenCalled();
  });

  it('getRole devuelve el detalle de un rol existente', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    const detail = await service.getRole('c_demo');

    expect(detail.key).toBe('c_demo');
    expect(detail.grants).toEqual([{ permissionKey: 'task:read', scope: 'PROJECT' }]);
  });

  it('getRole de un rol sin grants devuelve grants: [] y scope ORGANIZATION (A6)', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_3', key: 'c_vacio', label: 'Vacío', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([]);

    const detail = await service.getRole('c_vacio');

    expect(detail.grants).toEqual([]);
    expect(detail.allowedScopeTypes).toEqual(['ORGANIZATION']);
  });

  it('getRole lanza 404 si el rol no existe (findUnique → null)', async () => {
    prisma.role.findUnique.mockResolvedValue(null);

    await expect(service.getRole('c_no_existe')).rejects.toMatchObject({ status: 404 });
  });

  it('un error de BD en getRole NO se convierte en 404 (se propaga tal cual)', async () => {
    prisma.role.findUnique.mockRejectedValue(new Error('db down'));

    await expect(service.getRole('c_demo')).rejects.toThrow('db down');
  });
});

describe('RolesService.updateRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('rechaza con 403 si el rol es isSystem', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_1', key: 'org_admin', label: 'Admin', description: null, isSystem: true,
    });

    await expect(service.updateRole('org_admin', { label: 'Otro nombre' })).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('label/description-only: update simple, sin $transaction, sin tocar grants y SIN fga.resyncRole (A2)', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.role.update.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo actualizado', description: 'nueva desc', isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    const detail = await service.updateRole('c_demo', { label: 'Demo actualizado', description: 'nueva desc' });

    expect(detail.label).toBe('Demo actualizado');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(fga.resyncRole).not.toHaveBeenCalled();
  });

  it('al cambiar grants: valida, reemplaza el set dentro de $transaction y llama fga.resyncRole', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([
      { id: 'perm_assign', key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.update.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany
      // 1ª llamada: lectura de los grants PREVIOS (filas crudas, para poder restaurar)
      .mockResolvedValueOnce([{ roleId: 'role_2', permissionId: 'perm_read', scope: 'PROJECT' }])
      // 2ª llamada: loadGrants para el detalle final (include permission)
      .mockResolvedValueOnce([{ permission: { key: 'task:assign' }, scope: 'PROJECT' }]);

    const detail = await service.updateRole('c_demo', {
      grants: [{ permissionKey: 'task:assign', scope: 'PROJECT' }],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role_2' } });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'role_2', permissionId: 'perm_assign', scope: 'PROJECT' }],
    });
    expect(fga.resyncRole).toHaveBeenCalledTimes(1);
    expect(fga.resyncRole).toHaveBeenCalledWith('c_demo');
    expect(detail.grants).toEqual([{ permissionKey: 'task:assign', scope: 'PROJECT' }]);
  });

  it('si resyncRole falla: restaura los grants previos, reintenta resync best-effort y responde 502 FGA_SYNC_FAILED (A2)', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([
      { id: 'perm_assign', key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.update.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValueOnce([
      { roleId: 'role_2', permissionId: 'perm_read', scope: 'PROJECT' },
    ]);
    // El primer resync falla; el reintento best-effort (con los grants viejos) resuelve.
    fga.resyncRole.mockRejectedValueOnce(new Error('FGA caído'));

    await expect(
      service.updateRole('c_demo', { grants: [{ permissionKey: 'task:assign', scope: 'PROJECT' }] }),
    ).rejects.toMatchObject({ status: 502, response: { code: 'FGA_SYNC_FAILED' } });

    // Rollback: el ÚLTIMO createMany reescribe exactamente los grants previos.
    expect(prisma.rolePermission.createMany).toHaveBeenLastCalledWith({
      data: [{ roleId: 'role_2', permissionId: 'perm_read', scope: 'PROJECT' }],
    });
    // Dos transacciones: reemplazo + restauración.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    // Best-effort: segundo resyncRole tras restaurar.
    expect(fga.resyncRole).toHaveBeenCalledTimes(2);
  });

  it('rechaza grants inválidos en update con 400 NOT_COMPOSABLE (misma regla que create) sin tocar la BD', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([]);

    await expect(
      service.updateRole('c_demo', { grants: [{ permissionKey: 'no:existe', scope: 'PROJECT' }] }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(fga.resyncRole).not.toHaveBeenCalled();
  });
});

describe('RolesService.deleteRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('rechaza con 403 si el rol es isSystem', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_1', key: 'org_admin', label: 'Admin', description: null, isSystem: true,
    });

    await expect(service.deleteRole('org_admin')).rejects.toMatchObject({ status: 403 });
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('rechaza con 409 ROLE_IN_USE si tiene memberships', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.membership.count.mockResolvedValue(3);

    await expect(service.deleteRole('c_demo')).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROLE_IN_USE' },
    });
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('borra el rol si es custom y no tiene memberships', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.membership.count.mockResolvedValue(0);

    await service.deleteRole('c_demo');

    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role_2' } });
  });
});

describe('RolesService.allowedScopeTypes', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('devuelve ["PROJECT"] si algún grant STRUCTURAL es project-level', () => {
    const result = service.allowedScopeTypes([
      { permissionKey: 'task:read', scope: 'PROJECT' },
      { permissionKey: 'user:create', scope: 'GLOBAL' },
    ]);
    expect(result).toEqual(['PROJECT']);
  });

  it('devuelve ["ORGANIZATION"] si los STRUCTURAL son org-level', () => {
    const result = service.allowedScopeTypes([
      { permissionKey: 'finance:manage', scope: 'GLOBAL' },
    ]);
    expect(result).toEqual(['ORGANIZATION']);
  });

  it('devuelve ["ORGANIZATION"] si no hay grants STRUCTURAL (solo FUNCTIONAL)', () => {
    const result = service.allowedScopeTypes([
      { permissionKey: 'user:create', scope: 'GLOBAL' },
    ]);
    expect(result).toEqual(['ORGANIZATION']);
  });

  it('devuelve ["ORGANIZATION"] para grants vacíos (A6)', () => {
    expect(service.allowedScopeTypes([])).toEqual(['ORGANIZATION']);
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

describe('RolesService.cloneRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('clona el rol del sistema "qa" (grants reales del seed) omitiendo los no componibles y reportándolos (A7)', async () => {
    // findRoleOrThrow real = findUnique + null-check (no findUniqueOrThrow).
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_qa', key: 'qa', label: 'QA', description: null, isSystem: true, createdById: null,
    });
    prisma.rolePermission.findMany
      // 1ª llamada: grants del ORIGEN (los 4 del seed para 'qa')
      .mockResolvedValueOnce([
        { permission: { key: 'document:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
        { permission: { key: 'document:sign:qa', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
        { permission: { key: 'task:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
        { permission: { key: 'measurement:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
      ])
      // 2ª llamada: loadGrants del rol recién clonado (solo los componibles)
      .mockResolvedValueOnce([
        { permission: { key: 'task:read' }, scope: 'PROJECT' },
        { permission: { key: 'measurement:read' }, scope: 'PROJECT' },
      ]);
    // Catálogo para validateGrants/grantsToRolePermissionRows del clon (solo los que sobreviven al filtro):
    prisma.permission.findMany.mockResolvedValue([
      { id: 'p_task_read', key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { id: 'p_meas_read', key: 'measurement:read', label: 'Ver mediciones', module: 'proyectos', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.findMany.mockResolvedValue([]); // slugKey: sin colisión
    prisma.role.create.mockResolvedValue({
      id: 'role_new', key: 'c_qa_norte', label: 'QA Norte', description: null, isSystem: false,
    });

    const result = await service.cloneRole('qa', 'QA Norte');

    expect(result.role.key).toBe('c_qa_norte');
    expect(result.role.isSystem).toBe(false);
    expect(result.role.label).toBe('QA Norte');
    expect(result.role.grants).toEqual([
      { permissionKey: 'task:read', scope: 'PROJECT' },
      { permissionKey: 'measurement:read', scope: 'PROJECT' },
    ]);
    expect(result.omittedPermissionKeys).toEqual(['document:read', 'document:sign:qa']);
  });

  it('clona sin omisiones cuando todos los grants son componibles y atribuye el createdById del origen', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_src', key: 'c_origen', label: 'Origen', description: 'desc', isSystem: false, createdById: 'user_9',
    });
    prisma.rolePermission.findMany
      .mockResolvedValueOnce([{ permission: { key: 'task:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' }])
      .mockResolvedValueOnce([{ permission: { key: 'task:read' }, scope: 'PROJECT' }]);
    prisma.permission.findMany.mockResolvedValue([
      { id: 'p_task_read', key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue({
      id: 'role_new', key: 'c_copia', label: 'Copia', description: 'desc', isSystem: false,
    });

    const result = await service.cloneRole('c_origen', 'Copia');

    expect(result.omittedPermissionKeys).toEqual([]);
    expect(result.role.grants).toEqual([{ permissionKey: 'task:read', scope: 'PROJECT' }]);
    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: 'user_9' }) }),
    );
  });

  it('si TODOS los grants del origen son no componibles, crea un clon vacío y los reporta (A6+A7)', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role_qa', key: 'qa', label: 'QA', description: null, isSystem: true, createdById: null,
    });
    prisma.rolePermission.findMany
      .mockResolvedValueOnce([{ permission: { key: 'document:sign:qa', kind: 'STRUCTURAL' }, scope: 'PROJECT' }])
      .mockResolvedValueOnce([]); // loadGrants del clon vacío
    prisma.permission.findMany.mockResolvedValue([]);
    prisma.role.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue({
      id: 'role_new', key: 'c_qa_norte', label: 'QA Norte', description: null, isSystem: false,
    });

    const result = await service.cloneRole('qa', 'QA Norte');

    expect(result.role.grants).toEqual([]);
    expect(result.omittedPermissionKeys).toEqual(['document:sign:qa']);
  });

  it('lanza 404 si el rol origen no existe', async () => {
    // findRoleOrThrow real: findUnique → null ⇒ NotFoundException (no rejection del mock).
    prisma.role.findUnique.mockResolvedValue(null);

    await expect(service.cloneRole('c_no_existe', 'Nuevo')).rejects.toMatchObject({ status: 404 });
  });
});
