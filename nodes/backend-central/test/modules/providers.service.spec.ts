import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProvidersService } from '../../src/modules/providers/providers.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';

describe('ProvidersService', () => {
  let prismaMock: Record<string, unknown>;
  let txMock: Record<string, unknown>;
  let configMock: Record<string, unknown>;
  let gamificationMock: Record<string, unknown>;
  let service: ProvidersService;

  beforeEach(() => {
    txMock = {
      providerRating: {
        create: vi.fn((args) =>
          Promise.resolve({
            id: 'r-1',
            providerId: 'p-1',
            score: args.data.score,
            comment: args.data.comment,
            actorId: args.data.actorId,
            createdAt: new Date(),
            actor: { firstName: 'Marta', lastName: 'Gomez' },
          }),
        ),
        findMany: vi.fn(() => Promise.resolve([{ score: 4 }, { score: 5 }])),
      },
      provider: {
        update: vi.fn(() => Promise.resolve({ id: 'p-1', name: 'Prov A', score: 4.5 })),
      },
    };

    prismaMock = {
      $transaction: vi.fn((cb) => cb(txMock)),
      provider: {
        create: vi.fn((args) =>
          Promise.resolve({
            id: 'p-1',
            rut: args.data.rut || null,
            name: args.data.name,
            email: args.data.email || null,
            phone: args.data.phone || null,
            address: args.data.address || null,
            score: 0.0,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        findUnique: vi.fn(),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      providerRating: {
        findMany: vi.fn(() => Promise.resolve([])),
      },
      providerProduct: {
        create: vi.fn((args) =>
          Promise.resolve({
            id: 'prod-1',
            providerId: args.data.providerId,
            name: args.data.name,
            description: args.data.description || null,
            price: args.data.price || null,
            unit: args.data.unit || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      geminiUsage: {
        count: vi.fn(() => Promise.resolve(0)),
        create: vi.fn(() => Promise.resolve({ id: 'u-log-1' })),
      },
    };

    configMock = {
      get: vi.fn((key: string) => {
        if (key === 'GEMINI_API_KEY') return ''; // fallback to dev mockup mode
        return undefined;
      }),
    };

    gamificationMock = {
      awardPoints: vi.fn(() => Promise.resolve()),
    };

    service = new ProvidersService(
      prismaMock as unknown as PrismaService,
      configMock as unknown as ConfigService,
      gamificationMock as unknown as GamificationService,
    );
  });

  describe('Rating Calculations', () => {
    it('registra una calificación y recalcula el score promedio del proveedor', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce({ id: 'p-1', name: 'Proveedor 1' });

      const res = await service.submitRating('p-1', 'u-1', {
        score: 5,
        comment: 'Excelente servicio',
      });

      expect(res.score).toBe(5);
      expect(txMock.providerRating.create).toHaveBeenCalled();
      expect(txMock.provider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-1' },
          data: { score: 4.5 }, // (4+5)/2
        }),
      );
    });
  });

  describe('Gemini Quota limit', () => {
    it('falla si el usuario ya realizó 3 consultas de IA hoy', async () => {
      prismaMock.geminiUsage.count.mockResolvedValueOnce(3);

      await expect(service.cleanProviderData('u-1', 'messy text')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ejecuta con éxito (fallback dev) si no supera la cuota', async () => {
      prismaMock.geminiUsage.count.mockResolvedValueOnce(1);

      const res = await service.cleanProviderData('u-1', 'messy text');

      expect(res.name).toBe('Proveedor Demo Autodetectado');
      expect(prismaMock.geminiUsage.create).toHaveBeenCalled();
    });
  });
});
