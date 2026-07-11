import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OvertimeController } from '../../src/modules/overtime/overtime.controller';
import type { OvertimeService } from '../../src/modules/overtime/overtime.service';
import type { PermissionService } from '../../src/authz/permission.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import type { CreateOvertimeDto, ListOvertimeQueryDto } from '../../src/modules/overtime/dto/overtime.dto';

function make(effects: Record<string, 'allow' | 'deny'>) {
  const service = {
    create: vi.fn(() => Promise.resolve({ id: 'o-1' })),
    listAll: vi.fn(() => Promise.resolve([])),
    approve: vi.fn(() => Promise.resolve({ id: 'o-1' })),
  } as unknown as OvertimeService;
  const can = vi.fn((_u: string, key: string) =>
    Promise.resolve({ effect: effects[key] ?? 'deny', filter: { kind: 'none' } }),
  );
  const permissions = { can } as unknown as PermissionService;
  return { controller: new OvertimeController(service, permissions), service, can };
}

describe('OvertimeController gating', () => {
  const user = { id: 'u1' } as AuthUser;

  it('create pasa canOnBehalf=true cuando tiene el permiso', async () => {
    const { controller, service } = make({
      'finance:request:create': 'allow',
      'finance:overtime:create:onbehalf': 'allow',
    });
    await controller.create(user, {
      date: '2026-07-10T00:00:00.000Z',
      startTime: '09:00',
    } as CreateOvertimeDto);
    expect(service.create).toHaveBeenCalledWith('u1', expect.anything(), true);
  });

  it('create sin onbehalf pasa canOnBehalf=false', async () => {
    const { controller, service } = make({
      'finance:request:create': 'allow',
      'finance:overtime:create:onbehalf': 'deny',
    });
    await controller.create(user, {
      date: '2026-07-10T00:00:00.000Z',
      startTime: '09:00',
    } as CreateOvertimeDto);
    expect(service.create).toHaveBeenCalledWith('u1', expect.anything(), false);
  });

  it('listAll permitido con solo overtime:view:all (RH)', async () => {
    const { controller, service } = make({
      'finance:request:view:all': 'deny',
      'finance:overtime:view:all': 'allow',
    });
    await controller.listAll(user, {} as ListOvertimeQueryDto);
    expect(service.listAll).toHaveBeenCalled();
  });

  it('listAll denegado sin ningún view => Forbidden', async () => {
    const { controller } = make({
      'finance:request:view:all': 'deny',
      'finance:overtime:view:all': 'deny',
    });
    await expect(controller.listAll(user, {} as ListOvertimeQueryDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
