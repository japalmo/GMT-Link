import 'reflect-metadata';
import { BadRequestException, ForbiddenException, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
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
    monthlyApprovedReport: vi.fn(() =>
      Promise.resolve({ buffer: Buffer.from('xlsx'), filename: 'horas-extra-2026-07.xlsx' }),
    ),
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

  it('monthlyReport denegado sin finance:request:approve => Forbidden y no genera nada', async () => {
    const { controller, service } = make({ 'finance:request:approve': 'deny' });
    const res = { set: vi.fn() } as unknown as Response;
    await expect(controller.monthlyReport(user, res, '2026-07')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.monthlyApprovedReport).not.toHaveBeenCalled();
  });

  it('monthlyReport rechaza month ausente o mal formado (400) sin llamar al servicio', async () => {
    const { controller, service } = make({ 'finance:request:approve': 'allow' });
    const res = { set: vi.fn() } as unknown as Response;
    for (const bad of [undefined, '2026-7', '2026-13', '2026-00', 'abc']) {
      await expect(controller.monthlyReport(user, res, bad)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(service.monthlyApprovedReport).not.toHaveBeenCalled();
  });

  it('monthlyReport OK: fija cabeceras de descarga y devuelve el archivo', async () => {
    const { controller, service } = make({ 'finance:request:approve': 'allow' });
    const set = vi.fn();
    const res = { set } as unknown as Response;
    const file = await controller.monthlyReport(user, res, '2026-07');
    expect(service.monthlyApprovedReport).toHaveBeenCalledWith('2026-07');
    expect(file).toBeInstanceOf(StreamableFile);
    const headers = set.mock.calls[0]?.[0] as Record<string, string>;
    expect(headers['Content-Type']).toContain('spreadsheetml');
    expect(headers['Content-Disposition']).toContain('horas-extra-2026-07.xlsx');
  });
});
