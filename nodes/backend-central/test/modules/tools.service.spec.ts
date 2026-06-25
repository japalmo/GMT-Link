import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ToolsService } from '../../src/modules/tools/tools.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';

describe('ToolsService - Coordinates & GIS', () => {
  let prismaMock: Record<string, unknown>;
  let configMock: Record<string, unknown>;
  let service: ToolsService;

  beforeEach(() => {
    prismaMock = {
      geminiUsage: {
        count: vi.fn(() => Promise.resolve(0)),
        create: vi.fn(() => Promise.resolve({ id: 'u-log-1' })),
      },
    };

    configMock = {
      get: vi.fn((key: string) => {
        if (key === 'GEMINI_API_KEY') return ''; // dev mode fallback
        return undefined;
      }),
    };

    service = new ToolsService(
      prismaMock as unknown as PrismaService,
      configMock as unknown as ConfigService,
    );
  });

  describe('UTM and Lat/Long Conversions', () => {
    it('convierte UTM a Lat/Long correctamente (Zona 19 Sur)', () => {
      // Coordenadas aproximadas de Santiago Centro en UTM 19S
      const easting = 346200;
      const northing = 6296700;
      const res = service.convertPoint({
        direction: 'UTM_TO_LL' as const,
        easting,
        northing,
        zone: 19,
        southernHemisphere: true,
      });

      expect(res.latitude).toBeLessThan(-33.0);
      expect(res.latitude).toBeGreaterThan(-34.0);
      expect(res.longitude).toBeLessThan(-70.0);
      expect(res.longitude).toBeGreaterThan(-71.0);
    });

    it('convierte Lat/Long a UTM correctamente (Santiago)', () => {
      const latitude = -33.456;
      const longitude = -70.662;
      const res = service.convertPoint({
        direction: 'LL_TO_UTM' as const,
        latitude,
        longitude,
      });

      expect(res.zone).toBe(19);
      expect(res.southernHemisphere).toBe(true);
      expect(res.easting).toBeGreaterThan(340000);
      expect(res.easting).toBeLessThan(350000);
      expect(res.northing).toBeGreaterThan(6290000);
      expect(res.northing).toBeLessThan(6300000);
    });
  });

  describe('Shoreline detection quota', () => {
    it('bloquea la ejecución si la cuota de IA está completa', async () => {
      prismaMock.geminiUsage.count.mockResolvedValueOnce(3);

      await expect(service.detectShoreline('u-1', 'base64image')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ejecuta con éxito fallback si queda cuota disponible', async () => {
      prismaMock.geminiUsage.count.mockResolvedValueOnce(2);

      const res = await service.detectShoreline('u-1', 'base64image');

      expect(res.polygon.length).toBeGreaterThan(0);
      expect(prismaMock.geminiUsage.create).toHaveBeenCalled();
    });
  });
});
