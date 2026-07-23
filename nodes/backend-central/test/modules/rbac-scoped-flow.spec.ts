import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FgaService } from '../../src/fga/fga.service';
import { RolesService } from '../../src/modules/roles/roles.service';
import { UsersService } from '../../src/modules/users/users.service';
import type { FgaClientLike, TupleKey } from '../../src/fga/fga.types';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { EmailService } from '../../src/common/email.service';
import type { OvertimeService } from '../../src/modules/overtime/overtime.service';

/** Catálogo con el mapeo permiso→relación REAL del seed (prisma/seed.ts, A16). */
const PERMS = [
  { id: 'perm-project:read', key: 'project:read', label: 'Ver proyectos', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { id: 'perm-task:read', key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { id: 'perm-task:create', key: 'task:create', label: 'Crear tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_create_task', scopeable: true },
  { id: 'perm-task:assign', key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task', scopeable: true },
] as const;

type PermRow = (typeof PERMS)[number];

function permByKey(key: string): PermRow | undefined {
  return PERMS.find((p) => p.key === key);
}
function permById(id: string): PermRow | undefined {
  return PERMS.find((p) => p.id === id);
}

interface GrantRow {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

/**
 * Estado compartido en memoria: simula la parte de Postgres relevante a este
 * flujo (Role/RolePermission/Permission/Membership/Project/User) para poder
 * verificar el efecto de encadenar RolesService + UsersService + FgaService
 * reales (no mocks de esas 3 clases — solo Prisma y el cliente FGA son fakes).
 */
function buildInMemoryPrisma() {
  const roleRow: {
    id: string;
    key: string;
    label: string;
    description: string | null;
    isSystem: boolean;
    createdById: string | null;
    permissions: GrantRow[];
  } = {
    id: 'role-1',
    key: 'c_auditor',
    label: 'Auditor',
    description: null,
    isSystem: false,
    createdById: null,
    permissions: [
      { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      { scope: 'PROJECT', permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' } },
    ],
  };
  const memberships: Array<{ id: string; userId: string; roleKey: string; scopeType: string; scopeId: string }> = [];

  const prisma = {
    user: { findUnique: vi.fn(() => Promise.resolve({ id: 'u1' })) },
    project: { findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    role: {
      findUnique: vi.fn(() => Promise.resolve(roleRow)),
      // Unión multi-rol (Task 3.3): no hay otros roles custom en este flujo.
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve(roleRow)),
    },
    permission: {
      findMany: vi.fn((args: { where?: { key?: { in?: string[] } } }) => {
        const keys = args.where?.key?.in;
        const rows = keys === undefined ? [...PERMS] : PERMS.filter((p) => keys.includes(p.key));
        return Promise.resolve(rows);
      }),
    },
    membership: {
      findUnique: vi.fn(
        (args: {
          where: { userId_roleKey_scopeType_scopeId: { userId: string; roleKey: string; scopeType: string; scopeId: string } };
        }) => {
          const k = args.where.userId_roleKey_scopeType_scopeId;
          const found = memberships.find(
            (m) => m.userId === k.userId && m.roleKey === k.roleKey && m.scopeType === k.scopeType && m.scopeId === k.scopeId,
          );
          return Promise.resolve(found ?? null);
        },
      ),
      create: vi.fn((args: { data: { userId: string; roleKey: string; scopeType: string; scopeId: string } }) => {
        const row = { id: `m-${memberships.length + 1}`, ...args.data };
        memberships.push(row);
        return Promise.resolve(row);
      }),
      delete: vi.fn((args: { where: { id: string } }) => {
        const idx = memberships.findIndex((m) => m.id === args.where.id);
        if (idx >= 0) memberships.splice(idx, 1);
        return Promise.resolve(undefined);
      }),
      // Soporta los tres shapes de where usados por el código real:
      //  - { roleKey: 'c_auditor' }                       → resyncRole
      //  - { userId, scopeType, scopeId, roleKey: {not} } → unión multi-rol
      //  - { userId }                                     → currentRoles
      findMany: vi.fn((args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          roleKey?: string | { not: string };
          userId?: string;
          scopeType?: string;
          scopeId?: string;
        };
        return Promise.resolve(
          memberships.filter(
            (m) =>
              (typeof w.roleKey !== 'string' || m.roleKey === w.roleKey) &&
              (typeof w.roleKey !== 'object' || w.roleKey === null || m.roleKey !== w.roleKey.not) &&
              (w.userId === undefined || m.userId === w.userId) &&
              (w.scopeType === undefined || m.scopeType === w.scopeType) &&
              (w.scopeId === undefined || m.scopeId === w.scopeId),
          ),
        );
      }),
    },
    rolePermission: {
      // Lo leen loadGrants (getRole/updateRole, include: {permission}) y las
      // previousRows de updateRole (roleId/permissionId/scope, para rollback).
      // Devuelve un superset que satisface ambos shapes (extensión de fixture
      // prevista por el plan, Task 3.8 paso 3: extender el fixture, no la lógica).
      findMany: vi.fn(() =>
        Promise.resolve(
          roleRow.permissions.map((g) => ({
            roleId: roleRow.id,
            permissionId: permByKey(g.permission.key)?.id ?? g.permission.key,
            scope: g.scope,
            permission: g.permission,
          })),
        ),
      ),
      deleteMany: vi.fn(() => {
        roleRow.permissions = [];
        return Promise.resolve(undefined);
      }),
      createMany: vi.fn((args: { data: Array<{ roleId: string; permissionId: string; scope: string }> }) => {
        roleRow.permissions = args.data.map((d) => {
          const perm = permById(d.permissionId) ?? permByKey(d.permissionId);
          return {
            scope: d.scope,
            permission: {
              key: perm?.key ?? d.permissionId,
              kind: perm?.kind ?? 'STRUCTURAL',
              fgaRelation: perm?.fgaRelation ?? null,
            },
          };
        });
        return Promise.resolve(undefined);
      }),
    },
    $transaction: vi.fn(<T>(cb: (tx: unknown) => Promise<T>) => cb(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, roleRow, memberships };
}

function buildFgaClient(): { client: FgaClientLike; writes: TupleKey[]; deletes: TupleKey[] } {
  const writes: TupleKey[] = [];
  const deletes: TupleKey[] = [];
  const client: FgaClientLike = {
    check: vi.fn(() => Promise.resolve({ allowed: false })),
    write: vi.fn((body: { writes?: TupleKey[]; deletes?: TupleKey[] }) => {
      if (body.writes) writes.push(...body.writes);
      if (body.deletes) deletes.push(...body.deletes);
      return Promise.resolve(undefined);
    }),
  };
  return { client, writes, deletes };
}

describe('Flujo: rol custom → asignación por scope → resync → remove (mapeo real del seed)', () => {
  it('asigna con dedupe de can_view, resincroniza tras perder task:assign, y remueve limpiando can_view', async () => {
    const { prisma } = buildInMemoryPrisma();
    const { client, writes, deletes } = buildFgaClient();
    const fga = new FgaService(client, prisma);
    const roles = new RolesService(prisma, fga);
    const storage = { save: vi.fn() } as unknown as StorageService;
    const emailService = { send: vi.fn(() => Promise.resolve()) } as unknown as EmailService;
    const overtime = {
      recomputePendingForWorker: vi.fn(() => Promise.resolve(0)),
    } as unknown as OvertimeService;
    const users = new UsersService(prisma, fga, storage, roles, emailService, overtime);

    // 1) Asignar el rol custom a u1 en el proyecto p1.
    //    3 grants pero solo 2 tuplas: task:read y project:read comparten can_view (dedupe A5).
    await users.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' });
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });
    expect(writes).toHaveLength(2);

    writes.length = 0;
    deletes.length = 0;

    // 2) El rol pierde 'project:read' y 'task:assign' (updateRole de Fase 2 → resyncRole real de Task 3.4).
    await roles.updateRole('c_auditor', {
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    // can_view sigue deseada (task:read la sostiene) → se re-escribe tolerante, nunca se borra.
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
    // Única escritura: un delta que re-escribiera can_assign_task sería un bug.
    expect(writes).toHaveLength(1);
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });
    expect(deletes).not.toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });

    writes.length = 0;
    deletes.length = 0;

    // 3) Remover la asignación: borra la Membership y limpia la tupla vigente (can_view).
    await users.removeRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' });
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
  });
});
