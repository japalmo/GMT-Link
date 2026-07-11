import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import { PermissionService } from '../../src/authz/permission.service';

interface PrismaMock {
  membership: { findMany: ReturnType<typeof vi.fn> };
  rolePermission: { findMany: ReturnType<typeof vi.fn> };
  permission: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  project: { findMany: ReturnType<typeof vi.fn> };
}

function buildPrisma(
  over: {
    memberships?: unknown[];
    grants?: unknown[];
    permission?: unknown;
    allPermissions?: unknown[];
    deptProjects?: unknown[];
  } = {},
): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    membership: { findMany: vi.fn(() => Promise.resolve(over.memberships ?? [])) },
    rolePermission: { findMany: vi.fn(() => Promise.resolve(over.grants ?? [])) },
    permission: {
      findUnique: vi.fn(() => Promise.resolve(over.permission ?? null)),
      findMany: vi.fn(() => Promise.resolve(over.allPermissions ?? [])),
    },
    project: { findMany: vi.fn(() => Promise.resolve(over.deptProjects ?? [])) },
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

function buildFga(allowed = false): { fga: FgaService; check: ReturnType<typeof vi.fn> } {
  const check = vi.fn(() => Promise.resolve(allowed));
  return { fga: { check } as unknown as FgaService, check };
}

const orgMember = { roleKey: 'r', scopeType: 'ORGANIZATION', scopeId: 'gmt' };
const projMember = (id: string): unknown => ({ roleKey: 'operator', scopeType: 'PROJECT', scopeId: id });

describe('PermissionService', () => {
  it('SuperAdmin corto-circuita a allow/none', async () => {
    const { prisma } = buildPrisma();
    const svc = new PermissionService(prisma, buildFga().fga, ['super']);
    expect(await svc.can('super', 'project.create')).toEqual({ effect: 'allow', filter: { kind: 'none' } });
  });

  it('sin memberships → deny', async () => {
    const { prisma } = buildPrisma({ memberships: [] });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.can('u1', 'reimbursement.approve')).toEqual({ effect: 'deny', filter: { kind: 'none' } });
  });

  it('sin grants para el permiso → deny', async () => {
    const { prisma } = buildPrisma({ memberships: [orgMember], grants: [] });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect((await svc.can('u1', 'x')).effect).toBe('deny');
  });

  it('OWN → filtro own; recurso ajeno deny, propio allow', async () => {
    const { prisma } = buildPrisma({ memberships: [orgMember], grants: [{ scope: 'OWN' }] });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect((await svc.can('u1', 'overtime.read', { createdById: 'u2' })).effect).toBe('deny');
    expect(await svc.can('u1', 'overtime.read', { createdById: 'u1' })).toEqual({
      effect: 'allow',
      filter: { kind: 'own' },
    });
  });

  it('PROJECT estructural delega en fga.check', async () => {
    const { prisma } = buildPrisma({
      memberships: [projMember('p1')],
      grants: [{ scope: 'PROJECT' }],
      permission: { kind: 'STRUCTURAL', fgaRelation: 'can_submit_measurements' },
    });
    const { fga, check } = buildFga(true);
    const svc = new PermissionService(prisma, fga, []);
    const d = await svc.can('u1', 'measurement.submit', { projectId: 'p1' });
    expect(check).toHaveBeenCalledWith({
      user: 'user:u1',
      relation: 'can_submit_measurements',
      object: 'project:p1',
    });
    expect(d.effect).toBe('allow');
  });

  it('PROJECT funcional → pertenencia al set de proyectos del usuario', async () => {
    const { prisma } = buildPrisma({
      memberships: [projMember('p1')],
      grants: [{ scope: 'PROJECT' }],
      permission: { kind: 'FUNCTIONAL', fgaRelation: null },
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect((await svc.can('u1', 'reimbursement.read', { projectId: 'p1' })).effect).toBe('allow');
    expect((await svc.can('u1', 'reimbursement.read', { projectId: 'p2' })).effect).toBe('deny');
  });

  it('gana el scope más fuerte (GLOBAL > PROJECT)', async () => {
    const { prisma } = buildPrisma({ memberships: [orgMember], grants: [{ scope: 'PROJECT' }, { scope: 'GLOBAL' }] });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.scopeFilter('u1', 'reimbursement.read')).toEqual({ kind: 'none' });
  });

  it('PROJECT incluye expansión de DEPARTMENT', async () => {
    const { prisma } = buildPrisma({
      memberships: [{ roleKey: 'r', scopeType: 'DEPARTMENT', scopeId: 'd1' }],
      grants: [{ scope: 'PROJECT' }],
      deptProjects: [{ id: 'p9' }],
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.scopeFilter('u1', 'task.read')).toEqual({ kind: 'projects', ids: ['p9'] });
  });

  it('usersWithPermissionOnProject reúne los userIds (sin duplicados)', async () => {
    const { prisma, mock } = buildPrisma();
    mock.rolePermission.findMany.mockResolvedValue([{ role: { key: 'qa' } }, { role: { key: 'project_creator' } }]);
    mock.membership.findMany.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }, { userId: 'a' }]);
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.usersWithPermissionOnProject('document.sign.qa', 'p1')).toEqual(['a', 'b']);
  });

  describe('permissionKeysForUser', () => {
    it('SuperAdmin → todo el catálogo', async () => {
      const { prisma } = buildPrisma({ allPermissions: [{ key: 'a' }, { key: 'b' }] });
      const svc = new PermissionService(prisma, buildFga().fga, ['super']);
      expect(await svc.permissionKeysForUser('super')).toEqual(['a', 'b']);
    });

    it('sin memberships → []', async () => {
      const { prisma } = buildPrisma({ memberships: [] });
      const svc = new PermissionService(prisma, buildFga().fga, []);
      expect(await svc.permissionKeysForUser('u1')).toEqual([]);
    });

    it('union deduplicada de los grants de sus roles', async () => {
      const { prisma } = buildPrisma({
        memberships: [orgMember],
        grants: [
          { permission: { key: 'finance:request:create' } },
          { permission: { key: 'project:manage' } },
          { permission: { key: 'finance:request:create' } },
        ],
      });
      const svc = new PermissionService(prisma, buildFga().fga, []);
      const keys = await svc.permissionKeysForUser('u1');
      expect(new Set(keys)).toEqual(new Set(['finance:request:create', 'project:manage']));
    });
  });
});

describe('PermissionService — roles custom (matriz RBAC, §12)', () => {
  /** Shape del where real de `scopeFilter` sobre `rolePermission.findMany`. */
  interface GrantsWhereArgs {
    where: { role: { key: { in: string[] } }; permission: { key: string } };
  }

  function grantsWhere(mock: PrismaMock, call = 0): GrantsWhereArgs['where'] {
    return (mock.rolePermission.findMany.mock.calls[call]?.[0] as GrantsWhereArgs).where;
  }

  it('un grant FUNCTIONAL de un rol custom pasa can() (GLOBAL → allow / filtro none)', async () => {
    const { prisma, mock } = buildPrisma({
      memberships: [{ roleKey: 'c_reporteria', scopeType: 'ORGANIZATION', scopeId: 'gmt' }],
      grants: [{ scope: 'GLOBAL' }],
      permission: { kind: 'FUNCTIONAL', fgaRelation: null },
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.can('u1', 'finance:print:batch')).toEqual({
      effect: 'allow',
      filter: { kind: 'none' },
    });
    // Los grants se buscan por la clave del rol custom (tabla Role), no por lista estática.
    const where = grantsWhere(mock);
    expect(where.role.key.in).toContain('c_reporteria');
    expect(where.permission).toEqual({ key: 'finance:print:batch' });
  });

  it('grant FUNCTIONAL PROJECT de un rol custom: allow en el proyecto asignado, deny fuera', async () => {
    const { prisma, mock } = buildPrisma({
      memberships: [{ roleKey: 'c_reporteria', scopeType: 'PROJECT', scopeId: 'p1' }],
      grants: [{ scope: 'PROJECT' }],
      permission: { kind: 'FUNCTIONAL', fgaRelation: null },
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect((await svc.can('u1', 'task:time:read', { projectId: 'p1' })).effect).toBe('allow');
    expect((await svc.can('u1', 'task:time:read', { projectId: 'p2' })).effect).toBe('deny');
    expect(grantsWhere(mock).role.key.in).toContain('c_reporteria');
  });

  it('scope más fuerte gana también mezclando rol custom y rol del sistema (GLOBAL > PROJECT)', async () => {
    const { prisma, mock } = buildPrisma({
      memberships: [
        { roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' },
        { roleKey: 'c_reporteria', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      ],
      grants: [{ scope: 'PROJECT' }, { scope: 'GLOBAL' }],
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.scopeFilter('u1', 'task:time:read')).toEqual({ kind: 'none' });
    // La unión multi-rol consulta ambos roles (sistema + custom) en un solo where.
    const roleKeysIn = grantsWhere(mock).role.key.in;
    expect(roleKeysIn).toContain('c_reporteria');
    expect(roleKeysIn).toContain('operator');
  });
});
