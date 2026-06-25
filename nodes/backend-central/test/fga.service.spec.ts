import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FgaService } from '../src/fga/fga.service';
import type { FgaClientLike, MembershipInput } from '../src/fga/fga.types';

function buildClient() {
  const client = {
    check: vi.fn(() => Promise.resolve({ allowed: true })),
    write: vi.fn(() => Promise.resolve({})),
  };
  return { client, service: new FgaService(client as unknown as FgaClientLike) };
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
