import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import {
  LiquidationsService,
  type UploadedLiquidationFile,
} from '../../src/modules/liquidations/liquidations.service';
import type { CreateLiquidationDto } from '../../src/modules/liquidations/dto/liquidations.dto';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
  liquidation: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function buildPrisma(): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    user: { findUnique: vi.fn() },
    liquidation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

const file = (): UploadedLiquidationFile => ({
  buffer: Buffer.from('pdf'),
  originalname: 'liq.pdf',
  mimetype: 'application/pdf',
});

const dto = (over: Partial<CreateLiquidationDto> = {}): CreateLiquidationDto =>
  ({ userId: 'u-target', period: '2026-06', ...over }) as CreateLiquidationDto;

describe('LiquidationsService', () => {
  let mock: PrismaMock;
  let prisma: PrismaService;
  let storage: {
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let service: LiquidationsService;

  beforeEach(() => {
    const bits = buildPrisma();
    mock = bits.mock;
    prisma = bits.prisma;
    storage = {
      save: vi.fn(() => Promise.resolve({ url: 'http://x/files/liquidations/liq.pdf' })),
      delete: vi.fn(() => Promise.resolve()),
    };
    service = new LiquidationsService(prisma, storage as unknown as StorageService);
  });

  describe('create', () => {
    it('rechaza si el usuario destino no existe', async () => {
      mock.user.findUnique.mockResolvedValue(null);
      await expect(service.create('mgr', dto(), file())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rechaza con conflicto si ya hay liquidación para el periodo', async () => {
      mock.user.findUnique.mockResolvedValue({ id: 'u-target' });
      mock.liquidation.findUnique.mockResolvedValue({ id: 'liq-0' });
      await expect(service.create('mgr', dto(), file())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('guarda el archivo y crea la liquidación', async () => {
      mock.user.findUnique.mockResolvedValue({ id: 'u-target' });
      mock.liquidation.findUnique.mockResolvedValue(null);
      mock.liquidation.create.mockResolvedValue({ id: 'liq-1' });

      await service.create('mgr', dto({ period: '2026-05' }), file());

      expect(storage.save).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'liquidations', filename: 'liq.pdf' }),
      );
      expect(mock.liquidation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u-target',
            period: '2026-05',
            fileUrl: 'http://x/files/liquidations/liq.pdf',
            uploadedById: 'mgr',
          }),
        }),
      );
    });
  });

  describe('listados', () => {
    it('listMine filtra por usuario y ordena por periodo desc', async () => {
      mock.liquidation.findMany.mockResolvedValue([]);
      await service.listMine('u1');
      expect(mock.liquidation.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { period: 'desc' },
      });
    });

    it('listAll incluye el usuario', async () => {
      mock.liquidation.findMany.mockResolvedValue([]);
      await service.listAll();
      expect(mock.liquidation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: expect.objectContaining({ user: expect.anything() }) }),
      );
    });
  });

  describe('remove', () => {
    it('404 si la liquidación no existe', async () => {
      mock.liquidation.findUnique.mockResolvedValue(null);
      await expect(service.remove('liq-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(mock.liquidation.delete).not.toHaveBeenCalled();
    });

    it('borra la liquidación y el archivo (key decodificada del URL)', async () => {
      mock.liquidation.findUnique.mockResolvedValue({
        id: 'liq-1',
        fileUrl: 'http://x/files/liquidations/abc%20def.pdf',
      });
      await service.remove('liq-1');
      expect(mock.liquidation.delete).toHaveBeenCalledWith({ where: { id: 'liq-1' } });
      // /files/ marker + decodeURIComponent
      expect(storage.delete).toHaveBeenCalledWith('liquidations/abc def.pdf');
    });

    it('best-effort: si falla el borrado de storage, no propaga error', async () => {
      mock.liquidation.findUnique.mockResolvedValue({
        id: 'liq-1',
        fileUrl: 'http://x/files/liquidations/liq.pdf',
      });
      storage.delete.mockRejectedValue(new Error('storage down'));
      await expect(service.remove('liq-1')).resolves.toBeUndefined();
    });

    it('no llama a storage.delete si el fileUrl no tiene marcador /files/', async () => {
      mock.liquidation.findUnique.mockResolvedValue({ id: 'liq-1', fileUrl: 'http://x/otro/liq.pdf' });
      await service.remove('liq-1');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('no llama a storage.delete si fileUrl es null', async () => {
      mock.liquidation.findUnique.mockResolvedValue({ id: 'liq-1', fileUrl: null });
      await service.remove('liq-1');
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });
});
