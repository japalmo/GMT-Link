import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { ProjectAdminOption } from '@gmt-platform/contracts';
import type { AuthUser } from '../../src/authz/auth-user.types';
import type { UsersService } from '../../src/modules/users/users.service';
import type { UserRolesResponse } from '../../src/modules/users/users.types';
import { UsersController } from '../../src/modules/users/users.controller';
import { AssignRoleScopedDto } from '../../src/modules/users/dto/assign-role-scoped.dto';
import { ORG_ID } from '../../src/common/org.constant';

const response: UserRolesResponse = {
  id: 'u1',
  roleKeys: [],
  memberships: [{ roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }],
};

function buildService(): {
  service: UsersService;
  assignRoleScoped: ReturnType<typeof vi.fn>;
  removeRoleScoped: ReturnType<typeof vi.fn>;
} {
  const assignRoleScoped = vi.fn(() => Promise.resolve(response));
  const removeRoleScoped = vi.fn(() => Promise.resolve(response));
  return {
    service: { assignRoleScoped, removeRoleScoped } as unknown as UsersService,
    assignRoleScoped,
    removeRoleScoped,
  };
}

describe('UsersController — asignación por scope', () => {
  it('POST /users/:id/roles delega en usersService.assignRoleScoped(userId, input) con scope explícito y devuelve la respuesta extendida', async () => {
    const { service, assignRoleScoped } = buildService();
    const controller = new UsersController(service);
    const dto: AssignRoleScopedDto = { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' };

    const result = await controller.assignRoleScoped('u1', dto);

    expect(assignRoleScoped).toHaveBeenCalledWith('u1', {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });
    expect(result).toBe(response);
  });

  it('POST /users/:id/roles con body legacy {roleKey} default a ORGANIZATION/ORG_ID (retro-compat)', async () => {
    const { service, assignRoleScoped } = buildService();
    const controller = new UsersController(service);
    // Body viejo del front (roles-dialog.tsx): sólo roleKey, sin scope.
    const dto = { roleKey: 'viewer' } as AssignRoleScopedDto;

    const result = await controller.assignRoleScoped('u1', dto);

    expect(assignRoleScoped).toHaveBeenCalledWith('u1', {
      roleKey: 'viewer',
      scopeType: 'ORGANIZATION',
      scopeId: ORG_ID,
    });
    expect(result).toBe(response);
  });

  it('DELETE /users/:id/roles delega en usersService.removeRoleScoped(userId, query) con scope explícito', async () => {
    const { service, removeRoleScoped } = buildService();
    const controller = new UsersController(service);

    const result = await controller.removeRoleScoped('u1', 'c_auditor', 'PROJECT', 'p1');

    expect(removeRoleScoped).toHaveBeenCalledWith('u1', {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });
    expect(result).toBe(response);
  });

  it('DELETE /users/:id/roles sin scope en query default a ORGANIZATION/ORG_ID (retro-compat)', async () => {
    const { service, removeRoleScoped } = buildService();
    const controller = new UsersController(service);

    const result = await controller.removeRoleScoped('u1', 'viewer', undefined, undefined);

    expect(removeRoleScoped).toHaveBeenCalledWith('u1', {
      roleKey: 'viewer',
      scopeType: 'ORGANIZATION',
      scopeId: ORG_ID,
    });
    expect(result).toBe(response);
  });

  it('DELETE /users/:id/roles/:roleKey (path legacy) resuelve a ORGANIZATION/ORG_ID y delega en removeRoleScoped', async () => {
    const { service, removeRoleScoped } = buildService();
    const controller = new UsersController(service);

    const result = await controller.removeRole('u1', 'viewer');

    expect(removeRoleScoped).toHaveBeenCalledWith('u1', {
      roleKey: 'viewer',
      scopeType: 'ORGANIZATION',
      scopeId: ORG_ID,
    });
    expect(result).toBe(response);
  });
});

describe('UsersController — GET /users/project-admins', () => {
  const admins: ProjectAdminOption[] = [
    { id: 'u1', fullName: 'Ana Pérez', roleKeys: ['admin_contrato'] },
  ];
  const authUser: AuthUser = { id: 'requester' } as AuthUser;

  it('delega en usersService.listProjectAdmins cuando hay usuario autenticado', async () => {
    const listProjectAdmins = vi.fn(() => Promise.resolve(admins));
    const service = { listProjectAdmins } as unknown as UsersService;
    const controller = new UsersController(service);

    const result = await controller.listProjectAdmins(authUser);

    expect(listProjectAdmins).toHaveBeenCalledTimes(1);
    expect(result).toBe(admins);
  });

  it('401 si no hay usuario autenticado', () => {
    const listProjectAdmins = vi.fn(() => Promise.resolve(admins));
    const service = { listProjectAdmins } as unknown as UsersService;
    const controller = new UsersController(service);

    expect(() => controller.listProjectAdmins(undefined)).toThrow(UnauthorizedException);
    expect(listProjectAdmins).not.toHaveBeenCalled();
  });
});
