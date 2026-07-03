import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AssetsController } from '../../src/modules/assets/assets.controller';
import type { AssetsService } from '../../src/modules/assets/assets.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import {
  CreateAssetDto,
  AssignAssetDto,
  CreateAccessoryDto,
  UpdateAccessoryDto,
  UpdateChecklistTemplateDto,
} from '../../src/modules/assets/dto/assets.dto';

const USER: AuthUser = { id: 'u1', email: 'operador@gmt.cl' };

/** Gate esperado: la gestión de activos se decide con can_manage_assets sobre el proyecto. */
const MANAGE_GATE = { user: 'user:u1', relation: 'can_manage_assets', object: 'project:p1' };

interface Mocks {
  controller: AssetsController;
  check: ReturnType<typeof vi.fn>;
  service: Record<string, ReturnType<typeof vi.fn>>;
}

function buildController(options: { allowed?: boolean } = {}): Mocks {
  const check = vi.fn(() => Promise.resolve(options.allowed ?? true));
  const fga = { check } as unknown as FgaService;

  const asset = { id: 'a-1', projectId: 'p1' };
  const service = {
    create: vi.fn(() => Promise.resolve(asset)),
    getById: vi.fn(() => Promise.resolve(asset)),
    assign: vi.fn(() => Promise.resolve(asset)),
    addAccessory: vi.fn(() => Promise.resolve({ id: 'acc-1' })),
    updateAccessory: vi.fn(() => Promise.resolve({ id: 'acc-1' })),
    removeAccessory: vi.fn(() => Promise.resolve(undefined)),
    updateChecklistTemplate: vi.fn(() => Promise.resolve({ id: 'tpl-1' })),
  };

  return {
    controller: new AssetsController(service as unknown as AssetsService, fga),
    check,
    service,
  };
}

function createDto(): CreateAssetDto {
  return Object.assign(new CreateAssetDto(), {
    type: AssetType.EQUIPO,
    name: 'Generador 5kW',
    projectId: 'p1',
  });
}

describe('AssetsController — gate FGA propio de activos (can_manage_assets)', () => {
  it('create con projectId gatea con can_manage_assets sobre el proyecto', async () => {
    const { controller, check, service } = buildController();
    await controller.create(USER, createDto());
    expect(check).toHaveBeenCalledWith(MANAGE_GATE);
    expect(service.create).toHaveBeenCalled();
  });

  it('create deniega 403 (sin llamar al servicio) cuando el check es false', async () => {
    const { controller, service } = buildController({ allowed: false });
    await expect(controller.create(USER, createDto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('assign gatea con can_manage_assets sobre el proyecto del activo', async () => {
    const { controller, check, service } = buildController();
    await controller.assign(USER, 'a-1', Object.assign(new AssignAssetDto(), { assignedToId: 'u2' }));
    expect(check).toHaveBeenCalledWith(MANAGE_GATE);
    expect(service.assign).toHaveBeenCalledWith('a-1', 'u1', 'u2');
  });

  it('addAccessory gatea con can_manage_assets', async () => {
    const { controller, check, service } = buildController();
    await controller.addAccessory(USER, 'a-1', Object.assign(new CreateAccessoryDto(), { name: 'Cable' }));
    expect(check).toHaveBeenCalledWith(MANAGE_GATE);
    expect(service.addAccessory).toHaveBeenCalled();
  });

  it('updateAccessory gatea con can_manage_assets', async () => {
    const { controller, check, service } = buildController();
    await controller.updateAccessory(USER, 'a-1', 'acc-1', Object.assign(new UpdateAccessoryDto(), { name: 'Cable 2m' }));
    expect(check).toHaveBeenCalledWith(MANAGE_GATE);
    expect(service.updateAccessory).toHaveBeenCalled();
  });

  it('removeAccessory gatea con can_manage_assets', async () => {
    const { controller, check, service } = buildController();
    await controller.removeAccessory(USER, 'a-1', 'acc-1');
    expect(check).toHaveBeenCalledWith(MANAGE_GATE);
    expect(service.removeAccessory).toHaveBeenCalledWith('a-1', 'acc-1', 'u1');
  });

  it('updateChecklistTemplate gatea con can_manage_assets', async () => {
    const { controller, check, service } = buildController();
    await controller.updateChecklistTemplate(
      USER,
      'a-1',
      Object.assign(new UpdateChecklistTemplateDto(), { name: 'Diaria', items: [{ label: 'Aceite' }] }),
    );
    expect(check).toHaveBeenCalledWith(MANAGE_GATE);
    expect(service.updateChecklistTemplate).toHaveBeenCalledWith('a-1', 'u1', 'Diaria', [{ label: 'Aceite' }]);
  });
});
