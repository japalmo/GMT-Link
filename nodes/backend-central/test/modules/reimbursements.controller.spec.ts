import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReimbursementsController } from '../../src/modules/reimbursements/reimbursements.controller';
import type { ReimbursementsService } from '../../src/modules/reimbursements/reimbursements.service';
import type { PermissionService } from '../../src/authz/permission.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import type {
  CreateReimbursementDto,
  ListReimbursementsQueryDto,
} from '../../src/modules/reimbursements/dto/reimbursements.dto';

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

describe('ReimbursementsController.create (boleta obligatoria)', () => {
  const user = { id: 'u1' } as AuthUser;
  const dto = {
    amount: 15000,
    date: '2026-06-10T00:00:00.000Z',
    concept: 'Taxi',
  } as unknown as CreateReimbursementDto;

  it('sin archivo => BadRequest y no llama al service', async () => {
    const { controller, service } = make('allow');
    await expect(controller.create(user, dto, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('MIME no permitido => UnsupportedMediaType y no llama al service', async () => {
    const { controller, service } = make('allow');
    const bad = {
      buffer: Buffer.from('x'),
      originalname: 'nota.txt',
      mimetype: 'text/plain',
    } as Express.Multer.File;
    await expect(controller.create(user, dto, bad)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('con archivo válido => llama al service con el archivo validado', async () => {
    const { controller, service } = make('allow');
    const file = {
      buffer: Buffer.from('pdf'),
      originalname: 'boleta.pdf',
      mimetype: 'application/pdf',
    } as Express.Multer.File;
    await controller.create(user, dto, file);
    expect(service.create).toHaveBeenCalledWith('u1', dto, {
      buffer: file.buffer,
      originalname: 'boleta.pdf',
      mimetype: 'application/pdf',
    });
  });
});
