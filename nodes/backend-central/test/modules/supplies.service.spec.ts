import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SuppliesService } from '../../src/modules/supplies/supplies.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';


describe('SuppliesService', () => {
  let prismaMock: Record<string, unknown>;
  let txMock: Record<string, unknown>;
  let service: SuppliesService;

  beforeEach(() => {
    txMock = {
      supply: {
        upsert: vi.fn((args) => Promise.resolve({ id: 's-1', code: args.create.code, name: args.create.name })),
      },
      warehouse: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'w-1', name: 'Bodega Central' })),
      },
      warehouseStock: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        upsert: vi.fn(() => Promise.resolve({ warehouseId: 'w-1', supplyId: 's-1', quantity: 50 })),
        update: vi.fn(() => Promise.resolve({ warehouseId: 'w-1', supplyId: 's-1', quantity: 50 })),
      },
      warehouseTransaction: {
        create: vi.fn((args) =>
          Promise.resolve({
            id: 'tx-1',
            warehouseId: 'w-1',
            supplyId: 's-1',
            type: args.data.type,
            quantity: args.data.quantity,
            reason: args.data.reason,
            actorId: args.data.actorId,
            createdAt: new Date(),
            supply: { id: 's-1', code: 'S-COD', name: 'Insumo 1', category: 'cat', unit: 'un', providerId: null, createdAt: new Date(), updatedAt: new Date() },
            actor: { firstName: 'Juan', lastName: 'Perez' },
          }),
        ),
      },
    };

    prismaMock = {
      $transaction: vi.fn((cb) => cb(txMock)),
      warehouse: {
        create: vi.fn((args) =>
          Promise.resolve({
            id: 'w-1',
            code: args.data.code,
            name: args.data.name,
            location: args.data.location || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        findUnique: vi.fn(),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      supply: {
        create: vi.fn((args) =>
          Promise.resolve({
            id: 's-1',
            code: args.data.code,
            name: args.data.name,
            description: args.data.description || null,
            category: args.data.category || null,
            unit: args.data.unit || 'unidades',
            providerId: args.data.providerId || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        findUnique: vi.fn(),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      warehouseStock: {
        findMany: vi.fn(() => Promise.resolve([])),
      },
      warehouseTransaction: {
        findMany: vi.fn(() => Promise.resolve([])),
      },
      provider: {
        findUnique: vi.fn(),
      },
    };

    service = new SuppliesService(
      prismaMock as unknown as PrismaService,
      { awardPoints: vi.fn(() => Promise.resolve()) } as unknown as GamificationService,
    );
  });

  describe('Warehouse CRUD', () => {
    it('crea una bodega exitosamente', async () => {
      prismaMock.warehouse.findUnique.mockResolvedValueOnce(null);

      const res = await service.createWarehouse({
        code: 'B1',
        name: 'Bodega 1',
        location: 'Santiago',
      });

      expect(res.code).toBe('B1');
      expect(prismaMock.warehouse.create).toHaveBeenCalled();
    });

    it('falla si el código de bodega ya existe', async () => {
      prismaMock.warehouse.findUnique.mockResolvedValueOnce({ id: 'w-1' });

      await expect(
        service.createWarehouse({
          code: 'B1',
          name: 'Bodega 1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Stock Transactions', () => {
    it('registra una transacción de ingreso (ENTRY) correctamente', async () => {
      prismaMock.warehouse.findUnique.mockResolvedValueOnce({ id: 'w-1', name: 'Bodega A' });
      prismaMock.supply.findUnique.mockResolvedValueOnce({ id: 's-1', name: 'Pala' });

      txMock.warehouseStock.findUnique.mockResolvedValueOnce(null);

      const res = await service.registerTransaction('w-1', 'u-1', {
        supplyId: 's-1',
        type: 'ENTRY',
        quantity: 10,
        reason: 'Compra inicial',
      });

      expect(res.type).toBe('ENTRY');
      expect(res.quantity).toBe(10);
      expect(txMock.warehouseStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { warehouseId: 'w-1', supplyId: 's-1', quantity: 10 },
        }),
      );
    });

    it('falla egreso (EXIT) si no hay suficiente stock', async () => {
      prismaMock.warehouse.findUnique.mockResolvedValueOnce({ id: 'w-1', name: 'Bodega A' });
      prismaMock.supply.findUnique.mockResolvedValueOnce({ id: 's-1', name: 'Pala' });

      txMock.warehouseStock.findUnique.mockResolvedValueOnce({ quantity: 5 });

      await expect(
        service.registerTransaction('w-1', 'u-1', {
          supplyId: 's-1',
          type: 'EXIT',
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
