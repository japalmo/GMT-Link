import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

type MockFunction = ReturnType<typeof vi.fn>;

/** Fecha estable para las vistas (toISOString). */
const NOW = new Date('2026-07-15T12:00:00.000Z');

function makeSupply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's-1',
    code: 'ART-1',
    name: 'Guantes de cabritilla',
    description: null,
    category: 'EPP',
    unit: 'pares',
    brand: 'Acme',
    color: null,
    size: 'L',
    model: null,
    providerId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r-1',
    userId: 'worker-1',
    status: 'PENDIENTE',
    note: null,
    rejectionReason: null,
    decidedById: null,
    decidedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    user: { firstName: 'Ana', lastName: 'Rojas' },
    items: [
      { id: 'it-1', requestId: 'r-1', supplyId: 's-1', quantity: 3, supply: makeSupply() },
    ],
    ...overrides,
  };
}

describe('InventoryService', () => {
  let prismaMock: {
    $transaction: MockFunction;
    supply: {
      findUnique: MockFunction;
      findMany: MockFunction;
      create: MockFunction;
      update: MockFunction;
      count: MockFunction;
    };
    supplyProvider: {
      findUnique: MockFunction;
      create: MockFunction;
      update: MockFunction;
      delete: MockFunction;
    };
    supplyRequest: {
      findUnique: MockFunction;
      findMany: MockFunction;
      create: MockFunction;
      update: MockFunction;
      count: MockFunction;
    };
    supplyAssignment: { findMany: MockFunction; count: MockFunction };
    warehouse: { findUnique: MockFunction };
    provider: { findUnique: MockFunction };
  };
  let txMock: {
    supply: { findUnique: MockFunction; create: MockFunction; update: MockFunction };
    warehouse: { findUnique: MockFunction };
    warehouseStock: { findUnique: MockFunction; upsert: MockFunction };
    warehouseTransaction: { create: MockFunction };
    supplyRequest: { findUnique: MockFunction; update: MockFunction; updateMany: MockFunction };
    supplyAssignment: { create: MockFunction };
  };
  let service: InventoryService;

  beforeEach(() => {
    txMock = {
      supply: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        create: vi.fn((args) => Promise.resolve(makeSupply({ code: args.data.code, ...args.data }))),
        update: vi.fn((args) => Promise.resolve(makeSupply({ ...args.data }))),
      },
      warehouse: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'w-1', code: 'BOD1', name: 'Bodega Central' })),
      },
      warehouseStock: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        upsert: vi.fn(() => Promise.resolve({})),
      },
      warehouseTransaction: {
        create: vi.fn(() => Promise.resolve({ id: 'tx-1' })),
      },
      supplyRequest: {
        findUnique: vi.fn(() => Promise.resolve(makeRequest())),
        update: vi.fn((args) => Promise.resolve(makeRequest({ ...args.data }))),
        // Claim atómico de deliverRequest: por defecto la solicitud se reclama.
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      supplyAssignment: {
        create: vi.fn(() => Promise.resolve({ id: 'sa-1' })),
      },
    };

    prismaMock = {
      // Soporta la forma callback (import/deliver) y la forma array (motor de tablas).
      $transaction: vi.fn((arg: unknown) =>
        typeof arg === 'function' ? (arg as (tx: typeof txMock) => unknown)(txMock) : Promise.all(arg as Promise<unknown>[]),
      ),
      supply: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        findMany: vi.fn(() => Promise.resolve([])),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(() => Promise.resolve(0)),
      },
      supplyProvider: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      supplyRequest: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        findMany: vi.fn(() => Promise.resolve([])),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(() => Promise.resolve(0)),
      },
      supplyAssignment: {
        findMany: vi.fn(() => Promise.resolve([])),
        count: vi.fn(() => Promise.resolve(0)),
      },
      warehouse: {
        findUnique: vi.fn(),
      },
      provider: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'p-1', name: 'Proveedor Uno' })),
      },
    };

    service = new InventoryService(prismaMock as unknown as PrismaService);
  });

  describe('importItems', () => {
    it('crea el artículo por code y registra el stock inicial resolviendo la bodega POR CÓDIGO', async () => {
      const res = await service.importItems('admin-1', {
        items: [
          {
            code: 'ART-1',
            name: 'Guantes de cabritilla',
            brand: 'Acme',
            stocks: [{ warehouseCode: 'BOD1', quantity: 10 }],
          },
        ],
      });

      expect(res).toEqual({ created: 1, updated: 0, errors: [] });
      expect(txMock.supply.create).toHaveBeenCalled();
      expect(txMock.warehouse.findUnique).toHaveBeenCalledWith({ where: { code: 'BOD1' } });
      expect(txMock.warehouseStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { warehouseId: 'w-1', supplyId: 's-1', quantity: 10 },
        }),
      );
      expect(txMock.warehouseTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'ENTRY',
          quantity: 10,
          reason: 'Carga inicial masiva (Inventario)',
          actorId: 'admin-1',
        }),
      });
    });

    it('actualiza los descriptivos si el code ya existe (updated, no created)', async () => {
      txMock.supply.findUnique.mockResolvedValueOnce(makeSupply());

      const res = await service.importItems('admin-1', {
        items: [{ code: 'ART-1', name: 'Guantes nuevos' }],
      });

      expect(res).toEqual({ created: 0, updated: 1, errors: [] });
      expect(txMock.supply.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: 'ART-1' } }),
      );
      expect(txMock.supply.create).not.toHaveBeenCalled();
    });

    it('una fila con bodega inexistente queda en errors SIN abortar el lote', async () => {
      txMock.warehouse.findUnique.mockImplementation((args: { where: { code: string } }) =>
        Promise.resolve(
          args.where.code === 'BOD1' ? { id: 'w-1', code: 'BOD1', name: 'Bodega Central' } : null,
        ),
      );

      const res = await service.importItems('admin-1', {
        items: [
          { code: 'MALO-1', name: 'Fila mala', stocks: [{ warehouseCode: 'NOPE', quantity: 5 }] },
          { code: 'BUENO-1', name: 'Fila buena', stocks: [{ warehouseCode: 'BOD1', quantity: 2 }] },
        ],
      });

      expect(res.created).toBe(1);
      expect(res.updated).toBe(0);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]!.code).toBe('MALO-1');
      expect(res.errors[0]!.message).toContain('NOPE');
      // La fila buena sí registró su ENTRY.
      expect(txMock.warehouseTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('un error interno (no HTTP) NO se refleja al cliente: la fila queda con un mensaje genérico es-CL', async () => {
      txMock.supply.create.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

      const res = await service.importItems('admin-1', {
        items: [{ code: 'X-1', name: 'Fila con falla interna' }],
      });

      expect(res.created).toBe(0);
      expect(res.errors).toEqual([
        {
          code: 'X-1',
          message: 'No se pudo importar esta fila. Verifica los datos e intenta de nuevo.',
        },
      ]);
    });

    it('stock 0 o ausente NO registra movimientos (crear no implica stock)', async () => {
      const res = await service.importItems('admin-1', {
        items: [{ code: 'ART-2', name: 'Sin stock', stocks: [{ warehouseCode: 'BOD1', quantity: 0 }] }],
      });

      expect(res).toEqual({ created: 1, updated: 0, errors: [] });
      expect(txMock.warehouseStock.upsert).not.toHaveBeenCalled();
      expect(txMock.warehouseTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('deliverRequest', () => {
    it('reclama la solicitud con un claim atómico (PENDIENTE→ENTREGADA), descuenta stock, registra EXIT y crea una asignación por ítem', async () => {
      // La fila hidratada tras el claim ya refleja ENTREGADA + decidedBy/decidedAt.
      txMock.supplyRequest.findUnique.mockResolvedValueOnce(
        makeRequest({ status: 'ENTREGADA', decidedById: 'admin-1', decidedAt: NOW }),
      );
      txMock.warehouseStock.findUnique.mockResolvedValueOnce({ quantity: 10 });

      const res = await service.deliverRequest('r-1', 'admin-1', {
        warehouseId: 'w-1',
        note: 'Entrega en terreno',
      });

      expect(txMock.supplyRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'r-1', status: 'PENDIENTE' },
        data: expect.objectContaining({ status: 'ENTREGADA', decidedById: 'admin-1' }),
      });
      expect(txMock.warehouseStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: 7 } }),
      );
      expect(txMock.warehouseTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'EXIT',
          quantity: 3,
          reason: 'Entrega de solicitud de insumos',
          actorId: 'admin-1',
        }),
      });
      expect(txMock.supplyAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplyId: 's-1',
          userId: 'worker-1',
          quantity: 3,
          warehouseId: 'w-1',
          deliveredById: 'admin-1',
          requestId: 'r-1',
          note: 'Entrega en terreno',
        }),
      });
      expect(res.status).toBe('ENTREGADA');
    });

    it('400 con detalle si el stock es insuficiente, SIN escrituras de stock (el claim se revierte con la transacción)', async () => {
      txMock.warehouseStock.findUnique.mockResolvedValueOnce({ quantity: 2 });

      const call = service.deliverRequest('r-1', 'admin-1', { warehouseId: 'w-1' });
      await expect(call).rejects.toThrow(BadRequestException);
      await expect(call).rejects.toThrow(
        'Stock insuficiente de "Guantes de cabritilla" en la bodega: requerido 3, disponible 2',
      );

      // El claim ocurre dentro de la transacción: al lanzar el 400, Prisma
      // revierte TODO (claim incluido) en la BD real.
      expect(txMock.supplyRequest.updateMany).toHaveBeenCalled();
      expect(txMock.warehouseStock.upsert).not.toHaveBeenCalled();
      expect(txMock.warehouseTransaction.create).not.toHaveBeenCalled();
      expect(txMock.supplyAssignment.create).not.toHaveBeenCalled();
      expect(txMock.supplyRequest.update).not.toHaveBeenCalled();
    });

    it('agrega cantidades cuando la solicitud repite el mismo artículo en dos ítems', async () => {
      txMock.supplyRequest.findUnique.mockResolvedValueOnce(
        makeRequest({
          items: [
            { id: 'it-1', requestId: 'r-1', supplyId: 's-1', quantity: 3, supply: makeSupply() },
            { id: 'it-2', requestId: 'r-1', supplyId: 's-1', quantity: 4, supply: makeSupply() },
          ],
        }),
      );
      txMock.warehouseStock.findUnique.mockResolvedValueOnce({ quantity: 5 });

      await expect(
        service.deliverRequest('r-1', 'admin-1', { warehouseId: 'w-1' }),
      ).rejects.toThrow('Stock insuficiente de "Guantes de cabritilla" en la bodega: requerido 7, disponible 5');
      expect(txMock.warehouseStock.upsert).not.toHaveBeenCalled();
    });

    it('409 si la solicitud ya fue resuelta (el claim atómico devuelve count 0): cierra la carrera de entregas dobles', async () => {
      txMock.supplyRequest.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.deliverRequest('r-1', 'admin-1', { warehouseId: 'w-1' }),
      ).rejects.toThrow(ConflictException);
      expect(txMock.warehouseStock.upsert).not.toHaveBeenCalled();
      expect(txMock.supplyAssignment.create).not.toHaveBeenCalled();
    });

    it('404 si la solicitud no existe (claim count 0 y fila ausente)', async () => {
      txMock.supplyRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      txMock.supplyRequest.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.deliverRequest('r-nope', 'admin-1', { warehouseId: 'w-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(txMock.warehouseStock.upsert).not.toHaveBeenCalled();
    });

    it('404 si la bodega no existe', async () => {
      txMock.warehouse.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.deliverRequest('r-1', 'admin-1', { warehouseId: 'w-nope' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rejectRequest', () => {
    it('rechaza una solicitud PENDIENTE con motivo', async () => {
      prismaMock.supplyRequest.findUnique.mockResolvedValueOnce(makeRequest());
      prismaMock.supplyRequest.update.mockResolvedValueOnce(
        makeRequest({ status: 'RECHAZADA', rejectionReason: 'Sin presupuesto' }),
      );

      const res = await service.rejectRequest('r-1', 'admin-1', { reason: 'Sin presupuesto' });

      expect(prismaMock.supplyRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RECHAZADA',
            rejectionReason: 'Sin presupuesto',
            decidedById: 'admin-1',
          }),
        }),
      );
      expect(res.status).toBe('RECHAZADA');
    });

    it('409 si la solicitud ya fue resuelta', async () => {
      prismaMock.supplyRequest.findUnique.mockResolvedValueOnce(makeRequest({ status: 'RECHAZADA' }));

      await expect(service.rejectRequest('r-1', 'admin-1', {})).rejects.toThrow(ConflictException);
      expect(prismaMock.supplyRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('createMyRequest', () => {
    it('crea la solicitud con los ítems validados y el userId de la sesión', async () => {
      prismaMock.supply.findMany.mockResolvedValueOnce([{ id: 's-1' }]);
      prismaMock.supplyRequest.create.mockResolvedValueOnce(makeRequest());

      const res = await service.createMyRequest('worker-1', {
        note: 'Para faena norte',
        items: [{ supplyId: 's-1', quantity: 3 }],
      });

      expect(prismaMock.supplyRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'worker-1',
            note: 'Para faena norte',
            items: { create: [{ supplyId: 's-1', quantity: 3 }] },
          }),
        }),
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.supplyName).toBe('Guantes de cabritilla');
    });

    it('400 con los ids faltantes si algún artículo no existe', async () => {
      prismaMock.supply.findMany.mockResolvedValueOnce([{ id: 's-1' }]);

      await expect(
        service.createMyRequest('worker-1', {
          items: [
            { supplyId: 's-1', quantity: 1 },
            { supplyId: 's-nope', quantity: 2 },
          ],
        }),
      ).rejects.toThrow('s-nope');
      expect(prismaMock.supplyRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('listItemsTable', () => {
    it('agrega totalStock (suma de bodegas) y providerCount a cada fila', async () => {
      prismaMock.supply.findMany.mockResolvedValueOnce([
        {
          ...makeSupply(),
          stocks: [{ quantity: 4 }, { quantity: 6 }],
          _count: { supplyProviders: 2 },
        },
      ]);
      prismaMock.supply.count.mockResolvedValueOnce(1);

      const page = await service.listItemsTable({ page: 1, pageSize: 10 });

      expect(page.total).toBe(1);
      expect(page.items[0]!.totalStock).toBe(10);
      expect(page.items[0]!.providerCount).toBe(2);
      expect(page.items[0]!.brand).toBe('Acme');
    });
  });

  describe('createItem', () => {
    it('409 si el código ya existe', async () => {
      prismaMock.supply.findUnique.mockResolvedValueOnce(makeSupply());

      await expect(
        service.createItem({ code: 'ART-1', name: 'Duplicado' }),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.supply.create).not.toHaveBeenCalled();
    });
  });

  describe('linkProvider', () => {
    it('409 si el proveedor ya está vinculado al artículo', async () => {
      prismaMock.supply.findUnique.mockResolvedValueOnce(makeSupply());
      prismaMock.supplyProvider.findUnique.mockResolvedValueOnce({ id: 'l-1', supplyId: 's-1' });

      await expect(
        service.linkProvider('s-1', { providerId: 'p-1' }),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.supplyProvider.create).not.toHaveBeenCalled();
    });
  });

  describe('listCatalog', () => {
    it('devuelve la forma mínima ordenada por nombre (sin stock ni proveedores)', async () => {
      prismaMock.supply.findMany.mockResolvedValueOnce([
        { id: 's-1', code: 'ART-1', name: 'Guantes', unit: 'pares', category: 'EPP' },
      ]);

      const res = await service.listCatalog();

      expect(prismaMock.supply.findMany).toHaveBeenCalledWith({
        select: { id: true, code: true, name: true, unit: true, category: true },
        orderBy: { name: 'asc' },
      });
      expect(res).toEqual([
        { id: 's-1', code: 'ART-1', name: 'Guantes', unit: 'pares', category: 'EPP' },
      ]);
    });
  });

  describe('listAssignmentsTable', () => {
    it('pagina con total e hidrata el trabajador receptor (worker) de cada fila', async () => {
      prismaMock.supplyAssignment.findMany.mockResolvedValueOnce([
        {
          id: 'sa-1',
          supplyId: 's-1',
          userId: 'worker-1',
          quantity: 3,
          warehouseId: 'w-1',
          deliveredById: 'admin-1',
          requestId: 'r-1',
          note: null,
          createdAt: NOW,
          supply: makeSupply(),
          deliveredBy: { firstName: 'Berta', lastName: 'Soto' },
          user: { firstName: 'Ana', lastName: 'Rojas' },
        },
      ]);
      prismaMock.supplyAssignment.count.mockResolvedValueOnce(41);

      const page = await service.listAssignmentsTable({ page: 2, pageSize: 20 });

      expect(page.total).toBe(41);
      expect(page.page).toBe(2);
      expect(page.pageSize).toBe(20);
      expect(prismaMock.supplyAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(page.items[0]!.worker).toEqual({ firstName: 'Ana', lastName: 'Rojas' });
      expect(page.items[0]!.deliveredBy).toEqual({ firstName: 'Berta', lastName: 'Soto' });
      expect(page.items[0]!.supplyName).toBe('Guantes de cabritilla');
    });

    it('la búsqueda arma un OR insensitive sobre nombre del artículo y del trabajador', async () => {
      prismaMock.supplyAssignment.findMany.mockResolvedValueOnce([]);
      prismaMock.supplyAssignment.count.mockResolvedValueOnce(0);

      await service.listAssignmentsTable({ page: 1, pageSize: 10, search: 'guantes' });

      const expectedWhere = {
        OR: [
          { supply: { name: { contains: 'guantes', mode: 'insensitive' } } },
          { user: { firstName: { contains: 'guantes', mode: 'insensitive' } } },
          { user: { lastName: { contains: 'guantes', mode: 'insensitive' } } },
        ],
      };
      expect(prismaMock.supplyAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prismaMock.supplyAssignment.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('mis artículos (listMyAssignments) NO hidrata worker (queda undefined)', async () => {
      prismaMock.supplyAssignment.findMany.mockResolvedValueOnce([
        {
          id: 'sa-1',
          supplyId: 's-1',
          userId: 'worker-1',
          quantity: 3,
          warehouseId: 'w-1',
          deliveredById: 'admin-1',
          requestId: 'r-1',
          note: null,
          createdAt: NOW,
          supply: makeSupply(),
          deliveredBy: { firstName: 'Berta', lastName: 'Soto' },
        },
      ]);

      const res = await service.listMyAssignments('worker-1');

      expect(res[0]!.worker).toBeUndefined();
      expect(res[0]!.deliveredBy).toEqual({ firstName: 'Berta', lastName: 'Soto' });
    });
  });
});
