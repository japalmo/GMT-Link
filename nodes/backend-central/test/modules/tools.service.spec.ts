import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolsService } from '../../src/modules/tools/tools.service';
import { ConvertDirection } from '../../src/modules/tools/dto/tools.dto';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';

type MockFunction = ReturnType<typeof vi.fn>;

describe('ToolsService - Coordinates & GIS', () => {
  let prismaMock: { geminiUsage: { count: MockFunction; create: MockFunction } };
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
      // Sin clave NVIDIA (NVIDIA_API_KEY / NVIDIA_API_KEY_VISION) => el service
      // usa el fallback de desarrollo (polígono placeholder) sin llamada externa.
      get: vi.fn(() => undefined),
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
        direction: ConvertDirection.UTM_TO_LL,
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
        direction: ConvertDirection.LL_TO_UTM,
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

  describe('Shoreline detection sin límite de IA', () => {
    it('ejecuta aunque el usuario ya tenga muchos usos en el día (sin cuota)', async () => {
      // Antes existía un límite de 3/día; ahora los modelos NVIDIA son gratuitos
      // e ilimitados: un conteo alto no bloquea la ejecución.
      prismaMock.geminiUsage.count.mockResolvedValue(50);

      const res = await service.detectShoreline('u-1', 'base64image');

      expect(res.polygon.length).toBeGreaterThan(0);
      expect(prismaMock.geminiUsage.create).toHaveBeenCalled();
    });

    it('registra el uso como auditoría en cada ejecución', async () => {
      const res = await service.detectShoreline('u-1', 'base64image');

      expect(res.polygon.length).toBeGreaterThan(0);
      expect(prismaMock.geminiUsage.create).toHaveBeenCalledWith({
        data: { userId: 'u-1', action: 'SHORE_DETECTION' },
      });
    });
  });
});
