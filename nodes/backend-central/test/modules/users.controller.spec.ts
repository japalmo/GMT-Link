import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ProjectAdminOption } from '@gmt-platform/contracts';
import type { AuthUser } from '../../src/authz/auth-user.types';
import type { PermissionService } from '../../src/authz/permission.service';
import type { UsersService } from '../../src/modules/users/users.service';
import type { UserRolesResponse } from '../../src/modules/users/users.types';
import { UsersController } from '../../src/modules/users/users.controller';
import { AssignRoleScopedDto } from '../../src/modules/users/dto/assign-role-scoped.dto';
import { ORG_ID } from '../../src/common/org.constant';

/**
 * Mock de `PermissionService` para el gate de `/users/project-admins`. `can`
 * devuelve `allow` solo para las claves en `allowedKeys` (default: ambas), y
 * `deny` para el resto. El controller solo lee `.effect`.
 */
function buildPermissions(
  allowedKeys: readonly string[] = ['project:create', 'project:manage'],
): { permissions: PermissionService; can: ReturnType<typeof vi.fn> } {
  const can = vi.fn((_userId: string, key: string) =>
    Promise.resolve({ effect: allowedKeys.includes(key) ? 'allow' : 'deny' }),
  );
  return { permissions: { can } as unknown as PermissionService, can };
}

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
    const controller = new UsersController(service, buildPermissions().permissions);
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
    const controller = new UsersController(service, buildPermissions().permissions);
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
    const controller = new UsersController(service, buildPermissions().permissions);

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
    const controller = new UsersController(service, buildPermissions().permissions);

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
    const controller = new UsersController(service, buildPermissions().permissions);

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

  it('delega en usersService.listProjectAdmins cuando el usuario puede crear O gestionar proyectos', async () => {
    const listProjectAdmins = vi.fn(() => Promise.resolve(admins));
    const service = { listProjectAdmins } as unknown as UsersService;
    const controller = new UsersController(
      service,
      buildPermissions(['project:create', 'project:manage']).permissions,
    );

    const result = await controller.listProjectAdmins(authUser);

    expect(listProjectAdmins).toHaveBeenCalledTimes(1);
    expect(result).toBe(admins);
  });

  it('permite con SOLO project:create (department_admin / org_admin)', async () => {
    const listProjectAdmins = vi.fn(() => Promise.resolve(admins));
    const service = { listProjectAdmins } as unknown as UsersService;
    const controller = new UsersController(service, buildPermissions(['project:create']).permissions);

    await expect(controller.listProjectAdmins(authUser)).resolves.toBe(admins);
    expect(listProjectAdmins).toHaveBeenCalledTimes(1);
  });

  it('permite con SOLO project:manage (admin_contrato / gerencia_proyectos, que abren el form en el front)', async () => {
    const listProjectAdmins = vi.fn(() => Promise.resolve(admins));
    const service = { listProjectAdmins } as unknown as UsersService;
    const controller = new UsersController(service, buildPermissions(['project:manage']).permissions);

    await expect(controller.listProjectAdmins(authUser)).resolves.toBe(admins);
    expect(listProjectAdmins).toHaveBeenCalledTimes(1);
  });

  it('403 si el usuario no puede crear NI gestionar proyectos', async () => {
    const listProjectAdmins = vi.fn(() => Promise.resolve(admins));
    const service = { listProjectAdmins } as unknown as UsersService;
    const controller = new UsersController(service, buildPermissions([]).permissions);

    await expect(controller.listProjectAdmins(authUser)).rejects.toBeInstanceOf(ForbiddenException);
    expect(listProjectAdmins).not.toHaveBeenCalled();
  });

  it('401 si no hay usuario autenticado (no consulta permisos ni servicio)', async () => {
    const listProjectAdmins = vi.fn(() => Promise.resolve(admins));
    const service = { listProjectAdmins } as unknown as UsersService;
    const { permissions, can } = buildPermissions([]);
    const controller = new UsersController(service, permissions);

    await expect(controller.listProjectAdmins(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(can).not.toHaveBeenCalled();
    expect(listProjectAdmins).not.toHaveBeenCalled();
  });
});
