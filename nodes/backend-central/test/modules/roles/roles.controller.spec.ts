import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RolesController } from '../../../src/modules/roles/roles.controller';
import type { RolesService } from '../../../src/modules/roles/roles.service';

function makeServiceMock() {
  return {
    listPermissions: vi.fn(),
    listRoles: vi.fn(),
    getRole: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    cloneRole: vi.fn(),
  };
}

describe('RolesController', () => {
  it('GET /permissions delega en rolesService.listPermissions', async () => {
    const service = makeServiceMock();
    service.listPermissions.mockResolvedValue([{ module: 'tareas', items: [] }]);
    const controller = new RolesController(service as unknown as RolesService);

    const result = await controller.listPermissions();

    expect(result).toEqual([{ module: 'tareas', items: [] }]);
  });

  it('GET /roles delega en rolesService.listRoles', async () => {
    const service = makeServiceMock();
    service.listRoles.mockResolvedValue([]);
    const controller = new RolesController(service as unknown as RolesService);

    await controller.listRoles();

    expect(service.listRoles).toHaveBeenCalled();
  });

  it('GET /roles/:key delega en rolesService.getRole con el key del path', async () => {
    const service = makeServiceMock();
    service.getRole.mockResolvedValue({ key: 'c_demo' });
    const controller = new RolesController(service as unknown as RolesService);

    await controller.getRole('c_demo');

    expect(service.getRole).toHaveBeenCalledWith('c_demo');
  });

  it('POST /roles delega en rolesService.createRole con el usuario autenticado como createdById', async () => {
    const service = makeServiceMock();
    service.createRole.mockResolvedValue({ key: 'c_demo' });
    const controller = new RolesController(service as unknown as RolesService);
    const dto = { label: 'Demo', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' as const }] };

    await controller.createRole(dto, { id: 'user_1' });

    expect(service.createRole).toHaveBeenCalledWith(dto, 'user_1');
  });

  it('POST /roles sin usuario autenticado responde 401 (CurrentUser devuelve undefined)', async () => {
    const service = makeServiceMock();
    const controller = new RolesController(service as unknown as RolesService);

    await expect(controller.createRole({ label: 'Demo', grants: [] }, undefined)).rejects.toMatchObject({
      status: 401,
    });
    await expect(controller.createRole({ label: 'Demo', grants: [] }, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.createRole).not.toHaveBeenCalled();
  });

  it('PATCH /roles/:key delega en rolesService.updateRole', async () => {
    const service = makeServiceMock();
    service.updateRole.mockResolvedValue({ key: 'c_demo' });
    const controller = new RolesController(service as unknown as RolesService);
    const dto = { label: 'Nuevo' };

    await controller.updateRole('c_demo', dto);

    expect(service.updateRole).toHaveBeenCalledWith('c_demo', dto);
  });

  it('DELETE /roles/:key delega en rolesService.deleteRole', async () => {
    const service = makeServiceMock();
    const controller = new RolesController(service as unknown as RolesService);

    await controller.deleteRole('c_demo');

    expect(service.deleteRole).toHaveBeenCalledWith('c_demo');
  });

  it('POST /roles/:key/clone delega en rolesService.cloneRole con el ACTOR y devuelve role + omittedPermissionKeys (A7)', async () => {
    const service = makeServiceMock();
    service.cloneRole.mockResolvedValue({
      role: { key: 'c_demo_2' },
      omittedPermissionKeys: ['document:sign:qa'],
    });
    const controller = new RolesController(service as unknown as RolesService);

    const result = await controller.cloneRole('c_demo', { label: 'Demo copia' }, { id: 'user_1' });

    expect(service.cloneRole).toHaveBeenCalledWith('c_demo', 'Demo copia', 'user_1');
    expect(result).toEqual({ role: { key: 'c_demo_2' }, omittedPermissionKeys: ['document:sign:qa'] });
  });

  it('POST /roles/:key/clone sin usuario autenticado responde 401 (el clon debe quedar atribuido a un actor)', async () => {
    const service = makeServiceMock();
    const controller = new RolesController(service as unknown as RolesService);

    await expect(controller.cloneRole('c_demo', { label: 'Demo copia' }, undefined)).rejects.toMatchObject({
      status: 401,
    });
    expect(service.cloneRole).not.toHaveBeenCalled();
  });
});
