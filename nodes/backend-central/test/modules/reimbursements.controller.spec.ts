import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReimbursementsController } from '../../src/modules/reimbursements/reimbursements.controller';
import type { ReimbursementsService } from '../../src/modules/reimbursements/reimbursements.service';
import type { PermissionService } from '../../src/authz/permission.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import type { ListReimbursementsQueryDto } from '../../src/modules/reimbursements/dto/reimbursements.dto';

function make(effect: 'allow' | 'deny') {
  const service = {
    create: vi.fn(() => Promise.resolve({ id: 'r-1' })),
    listAll: vi.fn(() => Promise.resolve([])),
    approve: vi.fn(() => Promise.resolve({ id: 'r-1' })),
  } as unknown as ReimbursementsService;
  const can = vi.fn(() => Promise.resolve({ effect, filter: { kind: 'none' } }));
  const permissions = { can } as unknown as PermissionService;
  return { controller: new ReimbursementsController(service, permissions), service, can };
}

describe('ReimbursementsController gating', () => {
  const user = { id: 'u1' } as AuthUser;

  it('approve sin permiso => Forbidden y no llama al service', async () => {
    const { controller, service } = make('deny');
    await expect(controller.approve(user, 'r-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('approve con finance:request:approve => llama al service', async () => {
    const { controller, service, can } = make('allow');
    await controller.approve(user, 'r-1');
    expect(can).toHaveBeenCalledWith('u1', 'finance:request:approve');
    expect(service.approve).toHaveBeenCalledWith('u1', 'r-1');
  });

  it('listAll gatea con finance:request:view:all', async () => {
    const { controller, can } = make('allow');
    await controller.listAll(user, {} as ListReimbursementsQueryDto);
    expect(can).toHaveBeenCalledWith('u1', 'finance:request:view:all');
  });
});
