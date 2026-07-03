import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FgaService } from '../src/fga/fga.service';
import type { FgaClientLike, MembershipInput, TupleKey } from '../src/fga/fga.types';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ORG_ID } from '../src/common/org.constant';

function buildPrismaStub(): PrismaService {
  return {
    role: { findUnique: vi.fn(), findMany: vi.fn() },
    membership: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
  } as unknown as PrismaService;
}

function buildClient() {
  // Mocks tipados con el contrato real: `check` puede resolver sin `allowed`.
  const client = {
    check: vi.fn<FgaClientLike['check']>(() => Promise.resolve({ allowed: true })),
    write: vi.fn<FgaClientLike['write']>(() => Promise.resolve({})),
  };
  return {
    client,
    service: new FgaService(client as unknown as FgaClientLike, buildPrismaStub()),
  };
}

const membership = (over: Partial<MembershipInput> = {}): MembershipInput => ({
  userId: 'u1',
  roleKey: 'project_creator',
  scopeType: 'PROJECT',
  scopeId: 's1',
  ...over,
});

describe('FgaService', () => {
  let client: ReturnType<typeof buildClient>['client'];
  let service: FgaService;

  beforeEach(() => {
    const bits = buildClient();
    client = bits.client;
    service = bits.service;
  });

  describe('check', () => {
    it('devuelve true cuando OpenFGA responde allowed:true y reenvía los params', async () => {
      client.check.mockResolvedValue({ allowed: true });
      const params = { user: 'user:u1', relation: 'can_view', object: 'project:p1' };
      await expect(service.check(params)).resolves.toBe(true);
      expect(client.check).toHaveBeenCalledWith(params);
    });

    it('devuelve false cuando allowed es false', async () => {
      client.check.mockResolvedValue({ allowed: false });
      await expect(
        service.check({ user: 'user:u1', relation: 'can_view', object: 'project:p1' }),
      ).resolves.toBe(false);
    });

    it('devuelve false cuando allowed viene ausente (no asume permiso)', async () => {
      client.check.mockResolvedValue({});
      await expect(
        service.check({ user: 'user:u1', relation: 'can_view', object: 'project:p1' }),
      ).resolves.toBe(false);
    });
  });

  describe('writeTuples / deleteTuples', () => {
    it('writeTuples con lista vacía es no-op', async () => {
      await service.writeTuples([]);
      expect(client.write).not.toHaveBeenCalled();
    });

    it('writeTuples escribe en writes', async () => {
      const tuples = [{ user: 'user:u1', relation: 'owner', object: 'document:d1' }];
      await service.writeTuples(tuples);
      expect(client.write).toHaveBeenCalledWith({ writes: tuples });
    });

    it('deleteTuples con lista vacía es no-op', async () => {
      await service.deleteTuples([]);
      expect(client.write).not.toHaveBeenCalled();
    });

    it('deleteTuples escribe en deletes', async () => {
      const tuples = [{ user: 'user:u1', relation: 'owner', object: 'document:d1' }];
      await service.deleteTuples(tuples);
      expect(client.write).toHaveBeenCalledWith({ deletes: tuples });
    });
  });

  describe('syncMembershipToFGA — mapeo rol×scope → tupla (§4.3)', () => {
    const cases: Array<{ name: string; input: MembershipInput; expected: { relation: string; object: string } }> = [
      {
        name: 'org_admin + ORGANIZATION → organization#admin',
        input: membership({ roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
        expected: { relation: 'admin', object: 'organization:gmt' },
      },
      {
        name: 'department_admin + DEPARTMENT → department#admin',
        input: membership({ roleKey: 'department_admin', scopeType: 'DEPARTMENT', scopeId: 'dep1' }),
        expected: { relation: 'admin', object: 'department:dep1' },
      },
      {
        name: 'project_creator + PROJECT → project#project_creator',
        input: membership({ roleKey: 'project_creator', scopeType: 'PROJECT', scopeId: 'p1' }),
        expected: { relation: 'project_creator', object: 'project:p1' },
      },
      {
        name: 'supervisor (MVP) + PROJECT → project#project_creator',
        input: membership({ roleKey: 'supervisor', scopeType: 'PROJECT', scopeId: 'p1' }),
        expected: { relation: 'project_creator', object: 'project:p1' },
      },
      {
        name: 'ito (MVP) + PROJECT → project#client_ito',
        input: membership({ roleKey: 'ito', scopeType: 'PROJECT', scopeId: 'p1' }),
        expected: { relation: 'client_ito', object: 'project:p1' },
      },
      {
        name: 'client_signer + SERVICE → service#client_signer',
        input: membership({ roleKey: 'client_signer', scopeType: 'SERVICE', scopeId: 'srv1' }),
        expected: { relation: 'client_signer', object: 'service:srv1' },
      },
    ];

    for (const c of cases) {
      it(`create: ${c.name}`, async () => {
        await service.syncMembershipToFGA(c.input, 'create');
        expect(client.write).toHaveBeenCalledWith({
          writes: [{ user: `user:${c.input.userId}`, relation: c.expected.relation, object: c.expected.object }],
        });
      });
    }

    it('delete: borra la tupla mapeada', async () => {
      await service.syncMembershipToFGA(
        membership({ roleKey: 'operator', scopeType: 'SERVICE', scopeId: 'srv1' }),
        'delete',
      );
      expect(client.write).toHaveBeenCalledWith({
        deletes: [{ user: 'user:u1', relation: 'operator', object: 'service:srv1' }],
      });
    });

    const invalidCases: Array<{ name: string; input: MembershipInput }> = [
      { name: 'org_admin + PROJECT (rol no asignable en project)', input: membership({ roleKey: 'org_admin', scopeType: 'PROJECT' }) },
      { name: 'operator + ORGANIZATION', input: membership({ roleKey: 'operator', scopeType: 'ORGANIZATION' }) },
      { name: 'finance + SERVICE (no existe en service)', input: membership({ roleKey: 'finance', scopeType: 'SERVICE' }) },
      { name: 'rol desconocido + PROJECT', input: membership({ roleKey: 'rol_inexistente', scopeType: 'PROJECT' }) },
    ];

    for (const c of invalidCases) {
      it(`combo inválido lanza error: ${c.name}`, async () => {
        await expect(service.syncMembershipToFGA(c.input, 'create')).rejects.toThrow(/inválida/);
        expect(client.write).not.toHaveBeenCalled();
      });
    }
  });

});

describe('FgaService — constructor con PrismaService', () => {
  it('se construye recibiendo (client, prisma) sin lanzar', () => {
    const client = {
      check: vi.fn(() => Promise.resolve({ allowed: false })),
      write: vi.fn(() => Promise.resolve({})),
    };
    expect(
      () => new FgaService(client as unknown as FgaClientLike, buildPrismaStub()),
    ).not.toThrow();
  });
});

interface RoleGrantRow {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

interface OtherRoleRow {
  key: string;
  isSystem: boolean;
  permissions: RoleGrantRow[];
}

function buildPrismaForSync(opts: {
  grants: RoleGrantRow[] | null; // null = el rol no existe
  otherMemberships?: Array<{ roleKey: string }>;
  otherRoles?: OtherRoleRow[];
}): PrismaService {
  return {
    role: {
      findUnique: vi.fn(() =>
        Promise.resolve(
          opts.grants === null
            ? null
            : { key: 'c_auditor', isSystem: false, permissions: opts.grants },
        ),
      ),
      findMany: vi.fn(() => Promise.resolve(opts.otherRoles ?? [])),
    },
    membership: { findMany: vi.fn(() => Promise.resolve(opts.otherMemberships ?? [])) },
    permission: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;
}

function buildBareClient() {
  return {
    check: vi.fn(() => Promise.resolve({ allowed: false })),
    write: vi.fn(() => Promise.resolve({})),
  };
}

describe('FgaService.syncRoleAssignment', () => {
  it('op create: escribe tupla organization para un grant STRUCTURAL org-level', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID },
      'create',
    );

    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_review_documents', object: `organization:${ORG_ID}` }],
    });
  });

  it('op delete: borra la tupla project para un grant STRUCTURAL project-level', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        {
          scope: 'PROJECT',
          permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' },
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'delete',
    );

    expect(client.write).toHaveBeenCalledWith({
      deletes: [{ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' }],
    });
  });

  it('dedupe: project:read + task:read + measurement:read comparten can_view → UNA sola tupla', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
        { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
        { scope: 'PROJECT', permission: { key: 'measurement:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_view', object: 'project:p1' }],
    });
  });

  it('delete NO borra una tupla que otra membership custom del usuario sigue sosteniendo', async () => {
    // c_auditor otorga can_view vía task:read; c_reporte (también asignado a u1 en p1)
    // sigue otorgando can_view vía project:read → el delete no debe tocar la tupla.
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      ],
      otherMemberships: [{ roleKey: 'c_reporte' }],
      otherRoles: [
        {
          key: 'c_reporte',
          isSystem: false,
          permissions: [
            { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
          ],
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'delete',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('create NO re-escribe una tupla ya sostenida por otro rol custom (write FGA no idempotente)', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
        { scope: 'PROJECT', permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' } },
      ],
      otherMemberships: [{ roleKey: 'c_reporte' }],
      otherRoles: [
        {
          key: 'c_reporte',
          isSystem: false,
          permissions: [
            { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
          ],
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    // Solo se escribe can_assign_task; can_view ya existe (lo sostiene c_reporte).
    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' }],
    });
  });

  it('ignora grants FUNCTIONAL (no tienen fgaRelation)', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'task:time:log', kind: 'FUNCTIONAL', fgaRelation: null } },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('ignora grants STRUCTURAL cuyo object type no coincide con el scopeType de la asignación', async () => {
    // 'project:read' es de tipo 'project'; se asigna a nivel ORGANIZATION → no aplica.
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('lista vacía de tuplas → no llama write (no-op)', async () => {
    const prisma = buildPrismaForSync({ grants: [] });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('rol inexistente: no lanza y no escribe tuplas', async () => {
    const prisma = buildPrismaForSync({ grants: null });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await expect(
      svc.syncRoleAssignment(
        { userId: 'u1', roleKey: 'no_existe', scopeType: 'PROJECT', scopeId: 'p1' },
        'create',
      ),
    ).resolves.toBeUndefined();
    expect(client.write).not.toHaveBeenCalled();
  });
});

function buildRecordingClient(): { client: FgaClientLike; writes: TupleKey[]; deletes: TupleKey[] } {
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

function buildPrismaForResync(opts: {
  grants: RoleGrantRow[];
  memberships: Array<{ userId: string; roleKey: string; scopeType: string; scopeId: string }>;
  catalogRelations: string[]; // relaciones STRUCTURAL composables del object type (catálogo Permission)
  otherMemberships?: Array<{ roleKey: string }>;
  otherRoles?: OtherRoleRow[];
}): PrismaService {
  return {
    role: {
      findUnique: vi.fn(() =>
        Promise.resolve({ key: 'c_auditor', isSystem: false, permissions: opts.grants }),
      ),
      findMany: vi.fn(() => Promise.resolve(opts.otherRoles ?? [])),
    },
    membership: {
      // where.roleKey string → memberships del rol (resync);
      // where.roleKey {not} → memberships de OTROS roles (unión multi-rol).
      findMany: vi.fn((args: { where: { roleKey?: unknown } }) =>
        typeof args.where.roleKey === 'string'
          ? Promise.resolve(opts.memberships)
          : Promise.resolve(opts.otherMemberships ?? []),
      ),
    },
    permission: {
      findMany: vi.fn(() =>
        Promise.resolve(opts.catalogRelations.map((fgaRelation) => ({ fgaRelation }))),
      ),
    },
  } as unknown as PrismaService;
}

describe('FgaService.resyncRole — delta real', () => {
  it('si el rol perdió un grant STRUCTURAL, borra la tupla vieja de los miembros existentes', async () => {
    // c_auditor HOY solo tiene 'document:review' (perdió 'finance:manage').
    const prisma = buildPrismaForResync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID }],
      // Catálogo org real del seed: 3 relaciones composables org-level.
      catalogRelations: ['can_view_directory_extended', 'can_review_documents', 'can_manage_finance'],
    });
    const { client, writes, deletes } = buildRecordingClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    // Escribe la tupla vigente (document:review)...
    expect(writes).toContainEqual({
      user: 'user:u1',
      relation: 'can_review_documents',
      object: `organization:${ORG_ID}`,
    });
    // ...borra la de finance:manage, que ya no es grant del rol...
    expect(deletes).toContainEqual({
      user: 'user:u1',
      relation: 'can_manage_finance',
      object: `organization:${ORG_ID}`,
    });
    // ...y NUNCA borra una relación vigente.
    expect(deletes).not.toContainEqual({
      user: 'user:u1',
      relation: 'can_review_documents',
      object: `organization:${ORG_ID}`,
    });
  });

  it('editar el rol A no revoca lo que el rol B sigue otorgando (unión multi-rol)', async () => {
    // c_auditor perdió task:read (grants: []). u1 también tiene c_reporte en p1,
    // que otorga can_view vía project:read → resyncRole NO debe borrar can_view.
    const prisma = buildPrismaForResync({
      grants: [],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }],
      catalogRelations: ['can_view', 'can_create_task', 'can_assign_task'],
      otherMemberships: [{ roleKey: 'c_reporte' }],
      otherRoles: [
        {
          key: 'c_reporte',
          isSystem: false,
          permissions: [
            { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
          ],
        },
      ],
    });
    const { client, deletes } = buildRecordingClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    expect(deletes).not.toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
    // Las relaciones que nadie sostiene sí se limpian (tolerante si no existían).
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });
  });

  it('sin memberships del rol → no llama write', async () => {
    const prisma = buildPrismaForResync({ grants: [], memberships: [], catalogRelations: [] });
    const { client } = buildRecordingClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    expect(client.write).not.toHaveBeenCalled();
  });

  it('tolera los no-ops de FGA: "already exists" en write y "does not exist" en delete', async () => {
    const prisma = buildPrismaForResync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID }],
      catalogRelations: ['can_review_documents', 'can_manage_finance'],
    });
    const client: FgaClientLike = {
      check: vi.fn(() => Promise.resolve({ allowed: false })),
      write: vi.fn((body: { writes?: TupleKey[]; deletes?: TupleKey[] }) =>
        Promise.reject(
          new Error(
            body.writes
              ? 'cannot write a tuple which already exists'
              : 'cannot delete a tuple which does not exist',
          ),
        ),
      ),
    };
    const svc = new FgaService(client, prisma);

    await expect(svc.resyncRole('c_auditor')).resolves.toBeUndefined();
  });

  it('otros errores FGA SÍ se propagan (para que updateRole haga rollback + 502)', async () => {
    const prisma = buildPrismaForResync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID }],
      catalogRelations: ['can_review_documents'],
    });
    const client: FgaClientLike = {
      check: vi.fn(() => Promise.resolve({ allowed: false })),
      write: vi.fn(() => Promise.reject(new Error('connection refused'))),
    };
    const svc = new FgaService(client, prisma);

    await expect(svc.resyncRole('c_auditor')).rejects.toThrow(/connection refused/);
  });
});
