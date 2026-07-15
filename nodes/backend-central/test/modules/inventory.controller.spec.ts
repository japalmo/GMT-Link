import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InventoryController } from '../../src/modules/inventory/inventory.controller';
import type { InventoryService } from '../../src/modules/inventory/inventory.service';
import type { PermissionService } from '../../src/authz/permission.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import {
  CreateInventoryItemDto,
  CreateMyRequestDto,
  DeliverRequestDto,
  ImportInventoryDto,
  RejectRequestDto,
} from '../../src/modules/inventory/dto/inventory.dto';

const USER: AuthUser = { id: 'u1', email: 'logistica@gmt.cl' };

interface Mocks {
  controller: InventoryController;
  can: ReturnType<typeof vi.fn>;
  service: Record<string, ReturnType<typeof vi.fn>>;
}

function buildController(options: { allowed?: boolean } = {}): Mocks {
  const can = vi.fn(() =>
    Promise.resolve({
      effect: options.allowed === false ? ('deny' as const) : ('allow' as const),
      filter: { kind: 'none' as const },
    }),
  );
  const permissions = { can } as unknown as PermissionService;

  const emptyPage = { items: [], total: 0, page: 1, pageSize: 10 };
  const service = {
    listItemsTable: vi.fn(() => Promise.resolve(emptyPage)),
    createItem: vi.fn(() => Promise.resolve({ id: 'i-1' })),
    importItems: vi.fn(() => Promise.resolve({ created: 1, updated: 0, errors: [] })),
    getItemDetail: vi.fn(() => Promise.resolve({ id: 'i-1' })),
    updateItem: vi.fn(() => Promise.resolve({ id: 'i-1' })),
    linkProvider: vi.fn(() => Promise.resolve({ id: 'l-1' })),
    updateProviderLink: vi.fn(() => Promise.resolve({ id: 'l-1' })),
    unlinkProvider: vi.fn(() => Promise.resolve({ ok: true })),
    listRequestsTable: vi.fn(() => Promise.resolve(emptyPage)),
    deliverRequest: vi.fn(() => Promise.resolve({ id: 'r-1' })),
    rejectRequest: vi.fn(() => Promise.resolve({ id: 'r-1' })),
    listAssignmentsTable: vi.fn(() => Promise.resolve(emptyPage)),
    listCatalog: vi.fn(() => Promise.resolve([])),
    listMyAssignments: vi.fn(() => Promise.resolve([])),
    listMyRequests: vi.fn(() => Promise.resolve([])),
    createMyRequest: vi.fn(() => Promise.resolve({ id: 'r-1' })),
  };

  return {
    controller: new InventoryController(service as unknown as InventoryService, permissions),
    can,
    service,
  };
}

describe('InventoryController: gate inventory:access en catálogo y gestión', () => {
  it('el catálogo (items/table) gatea con inventory:access', async () => {
    const { controller, can, service } = buildController();
    await controller.listItemsTable(USER);
    expect(can).toHaveBeenCalledWith('u1', 'inventory:access');
    expect(service.listItemsTable).toHaveBeenCalled();
  });

  it('403 sin inventory:access (crear artículo), sin llamar al servicio', async () => {
    const { controller, service } = buildController({ allowed: false });
    await expect(
      controller.createItem(USER, Object.assign(new CreateInventoryItemDto(), { code: 'A', name: 'Art' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createItem).not.toHaveBeenCalled();
  });

  it('403 sin inventory:access (import masivo), sin llamar al servicio', async () => {
    const { controller, service } = buildController({ allowed: false });
    await expect(
      controller.importItems(USER, Object.assign(new ImportInventoryDto(), { items: [] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.importItems).not.toHaveBeenCalled();
  });

  it('el import pasa el actorId de la sesión al servicio', async () => {
    const { controller, service } = buildController();
    const dto = Object.assign(new ImportInventoryDto(), { items: [] });
    await controller.importItems(USER, dto);
    expect(service.importItems).toHaveBeenCalledWith('u1', dto);
  });

  it('403 sin inventory:access (entregar solicitud), sin llamar al servicio', async () => {
    const { controller, service } = buildController({ allowed: false });
    await expect(
      controller.deliverRequest(USER, 'r-1', Object.assign(new DeliverRequestDto(), { warehouseId: 'w-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.deliverRequest).not.toHaveBeenCalled();
  });

  it('entregar delega con el actorId de la sesión', async () => {
    const { controller, can, service } = buildController();
    const dto = Object.assign(new DeliverRequestDto(), { warehouseId: 'w-1' });
    await controller.deliverRequest(USER, 'r-1', dto);
    expect(can).toHaveBeenCalledWith('u1', 'inventory:access');
    expect(service.deliverRequest).toHaveBeenCalledWith('r-1', 'u1', dto);
  });

  it('rechazar gatea y delega con el actorId de la sesión', async () => {
    const { controller, can, service } = buildController();
    const dto = Object.assign(new RejectRequestDto(), { reason: 'Sin stock' });
    await controller.rejectRequest(USER, 'r-1', dto);
    expect(can).toHaveBeenCalledWith('u1', 'inventory:access');
    expect(service.rejectRequest).toHaveBeenCalledWith('r-1', 'u1', dto);
  });

  it('el historial de entregas (assignments/table) gatea con inventory:access y arma el TableRequest', async () => {
    const { controller, can, service } = buildController();
    await controller.listAssignmentsTable(USER, '2', '25', 'guantes', 'cantidad', 'asc');
    expect(can).toHaveBeenCalledWith('u1', 'inventory:access');
    expect(service.listAssignmentsTable).toHaveBeenCalledWith({
      page: 2,
      pageSize: 25,
      search: 'guantes',
      sortBy: 'cantidad',
      sortDir: 'asc',
    });
  });

  it('403 sin inventory:access (historial de entregas), sin llamar al servicio', async () => {
    const { controller, service } = buildController({ allowed: false });
    await expect(controller.listAssignmentsTable(USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listAssignmentsTable).not.toHaveBeenCalled();
  });

  it('401 sin sesión en rutas gateadas', async () => {
    const { controller, service } = buildController();
    await expect(controller.listItemsTable(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.listItemsTable).not.toHaveBeenCalled();
  });
});

describe('InventoryController: rutas propias (userId de la sesión; gate inventory:request:own)', () => {
  it('me/assignments NO consulta el permiso (comprobante propio, solo sesión)', async () => {
    const { controller, can, service } = buildController({ allowed: false });
    await controller.listMyAssignments(USER);
    expect(can).not.toHaveBeenCalled();
    expect(service.listMyAssignments).toHaveBeenCalledWith('u1');
  });

  it('me/requests gatea con inventory:request:own y usa el userId de la sesión', async () => {
    const { controller, can, service } = buildController();
    await controller.listMyRequests(USER);
    expect(can).toHaveBeenCalledWith('u1', 'inventory:request:own');
    expect(service.listMyRequests).toHaveBeenCalledWith('u1');
  });

  it('403 sin inventory:request:own (me/requests), sin llamar al servicio', async () => {
    const { controller, service } = buildController({ allowed: false });
    await expect(controller.listMyRequests(USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listMyRequests).not.toHaveBeenCalled();
  });

  it('crear solicitud propia gatea con inventory:request:own y usa SIEMPRE el userId de la sesión (nunca del body)', async () => {
    const { controller, can, service } = buildController();
    const dto = Object.assign(new CreateMyRequestDto(), {
      items: [{ supplyId: 's-1', quantity: 2 }],
    });
    await controller.createMyRequest(USER, dto);
    expect(can).toHaveBeenCalledWith('u1', 'inventory:request:own');
    expect(service.createMyRequest).toHaveBeenCalledWith('u1', dto);
  });

  it('403 sin inventory:request:own (crear solicitud propia), sin llamar al servicio', async () => {
    const { controller, service } = buildController({ allowed: false });
    const dto = Object.assign(new CreateMyRequestDto(), {
      items: [{ supplyId: 's-1', quantity: 2 }],
    });
    await expect(controller.createMyRequest(USER, dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createMyRequest).not.toHaveBeenCalled();
  });

  it('me/catalog gatea con inventory:request:own (un externo no enumera el catálogo)', async () => {
    const { controller, can, service } = buildController();
    await controller.listCatalog(USER);
    expect(can).toHaveBeenCalledWith('u1', 'inventory:request:own');
    expect(service.listCatalog).toHaveBeenCalled();
  });

  it('403 sin inventory:request:own (me/catalog), sin llamar al servicio', async () => {
    const { controller, service } = buildController({ allowed: false });
    await expect(controller.listCatalog(USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listCatalog).not.toHaveBeenCalled();
  });

  it('401 sin sesión en me/catalog', async () => {
    const { controller, service } = buildController();
    await expect(controller.listCatalog(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.listCatalog).not.toHaveBeenCalled();
  });

  it('401 sin sesión en rutas propias', async () => {
    const { controller, service } = buildController();
    await expect(controller.listMyRequests(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.listMyRequests).not.toHaveBeenCalled();
  });
});
