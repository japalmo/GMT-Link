import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsController } from '../../../src/modules/projects/projects.controller';
import type { ProjectsService } from '../../../src/modules/projects/projects.service';
import type { PermissionService } from '../../../src/authz/permission.service';

/**
 * GET /projects/departments y GET /projects/clients respondían a cualquiera, sin
 * sesión: un anónimo podía listar departamentos y clientes. Ninguna página
 * pública los usa (solo el formulario de tickets, que exige sesión).
 */
describe('ProjectsController — listados de formularios exigen sesión', () => {
  const listDepartments = vi.fn(() => Promise.resolve([]));
  const listClients = vi.fn(() => Promise.resolve([]));
  let controller: ProjectsController;

  beforeEach(() => {
    listDepartments.mockClear();
    listClients.mockClear();
    controller = new ProjectsController(
      { listDepartments, listClients } as unknown as ProjectsService,
      {} as PermissionService,
    );
  });

  it('GET /projects/departments sin usuario → 401 y no consulta', () => {
    expect(() => controller.listDepartments(undefined)).toThrow(UnauthorizedException);
    expect(listDepartments).not.toHaveBeenCalled();
  });

  it('GET /projects/clients sin usuario → 401 y no consulta', () => {
    expect(() => controller.listClients(undefined)).toThrow(UnauthorizedException);
    expect(listClients).not.toHaveBeenCalled();
  });

  it('con sesión ambos listados responden igual que antes', async () => {
    const user = { id: 'u-1', email: 'a@gmt.cl' };
    await expect(controller.listDepartments(user)).resolves.toEqual([]);
    await expect(controller.listClients(user)).resolves.toEqual([]);
  });
});
