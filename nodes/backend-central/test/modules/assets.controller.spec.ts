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
    listDocuments: vi.fn(() => Promise.resolve([])),
    getHistory: vi.fn(() => Promise.resolve([])),
    listAccessories: vi.fn(() => Promise.resolve([])),
    getChecklistTemplate: vi.fn(() => Promise.resolve({ id: 'tpl-1' })),
    listChecklistSubmissions: vi.fn(() => Promise.resolve([])),
    takeUse: vi.fn(() => Promise.resolve(asset)),
    releaseUse: vi.fn(() => Promise.resolve(asset)),
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

describe('AssetsController — GET de lectura sin guard can_view_list', () => {
  // Los GET de lectura pura no llevan @RequirePermission: la autorización
  // (asset:read con respaldo estructural) la resuelve el servicio. getById es la
  // única excepción: además consulta can_manage_assets para exponer
  // `canManageAssets` (no es un gate, no bloquea la lectura).
  it('getById delega en el servicio y adjunta canManageAssets (consulta FGA, no gatea)', async () => {
    const { controller, check, service } = buildController();
    const res = await controller.getById(USER, 'a-1');
    expect(service.getById).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).toHaveBeenCalledWith(MANAGE_GATE);
    expect(res).toEqual({ id: 'a-1', projectId: 'p1', canManageAssets: true });
  });

  it('listDocuments delega con userId sin gate FGA', async () => {
    const { controller, check, service } = buildController();
    await controller.listDocuments(USER, 'a-1');
    expect(service.listDocuments).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).not.toHaveBeenCalled();
  });

  it('getHistory delega con userId sin gate FGA', async () => {
    const { controller, check, service } = buildController();
    await controller.getHistory(USER, 'a-1');
    expect(service.getHistory).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).not.toHaveBeenCalled();
  });

  it('listAccessories delega con userId sin gate FGA', async () => {
    const { controller, check, service } = buildController();
    await controller.listAccessories(USER, 'a-1');
    expect(service.listAccessories).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).not.toHaveBeenCalled();
  });

  it('getChecklistTemplate delega con userId sin gate FGA', async () => {
    const { controller, check, service } = buildController();
    await controller.getChecklistTemplate(USER, 'a-1');
    expect(service.getChecklistTemplate).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).not.toHaveBeenCalled();
  });

  it('listChecklistSubmissions delega con userId sin gate FGA', async () => {
    const { controller, check, service } = buildController();
    await controller.listChecklistSubmissions(USER, 'a-1');
    expect(service.listChecklistSubmissions).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).not.toHaveBeenCalled();
  });
});

describe('AssetsController — use/release sin guard can_view_list', () => {
  // El guard @RequirePermission('can_view_list') era INSATISFACIBLE para los
  // vehículos de flota (projectId null, sin tupla FGA). Se eliminó y la
  // autorización (asset:use:report con respaldo de visibilidad) vive en el
  // servicio: el controller solo delega.
  it('takeUse delega en el servicio sin gate FGA del controller', async () => {
    const { controller, check, service } = buildController();
    await controller.takeUse(USER, 'a-1');
    expect(service.takeUse).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).not.toHaveBeenCalled();
  });

  it('releaseUse delega en el servicio sin gate FGA del controller', async () => {
    const { controller, check, service } = buildController();
    await controller.releaseUse(USER, 'a-1');
    expect(service.releaseUse).toHaveBeenCalledWith('a-1', 'u1');
    expect(check).not.toHaveBeenCalled();
  });
});
