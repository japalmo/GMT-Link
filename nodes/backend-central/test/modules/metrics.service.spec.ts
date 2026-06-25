import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MetricsService } from '../../src/modules/metrics/metrics.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { EmailService } from '../../src/common/email.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { SaveDataPointDto } from '../../src/modules/metrics/dto/metrics.dto';

describe('MetricsService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let emailServiceMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fgaServiceMock: any;
  let service: MetricsService;

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn((ops: unknown[]) => {
        if (Array.isArray(ops)) {
          return Promise.all(ops);
        }
        if (typeof ops === 'function') {
          return ops(prismaMock);
        }
        return Promise.resolve(ops);
      }),
      element: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
      service: {
        findUnique: vi.fn(),
      },
      phase: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      variable: {
        findMany: vi.fn(),
      },
      dataPoint: {
        create: vi.fn(),
        createManyAndReturn: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      pointsLog: {
        create: vi.fn(),
      },
      otpCode: {
        updateMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      project: {
        findUnique: vi.fn(),
      },
      membership: {
        findFirst: vi.fn(),
      },
    };

    emailServiceMock = {
      send: vi.fn(() => Promise.resolve()),
    };

    fgaServiceMock = {
      check: vi.fn(() => Promise.resolve(true)),
    };

    service = new MetricsService(
      prismaMock as unknown as PrismaService,
      emailServiceMock as unknown as EmailService,
      fgaServiceMock as unknown as FgaService,
    );
  });

  describe('Resolvers de ProjectId para scoping', () => {
    it('getProjectIdForElementCode debería retornar projectId o lanzar error si no existe', async () => {
      prismaMock.element.findUnique.mockResolvedValue({ projectId: 'proj-1' });
      const projectId = await service.getProjectIdForElementCode('R1');
      expect(projectId).toBe('proj-1');

      prismaMock.element.findUnique.mockResolvedValue(null);
      await expect(service.getProjectIdForElementCode('R2')).rejects.toThrow(NotFoundException);
    });

    it('getProjectIdForServiceId debería retornar projectId o lanzar error si no existe', async () => {
      prismaMock.service.findUnique.mockResolvedValue({ projectId: 'proj-2' });
      const projectId = await service.getProjectIdForServiceId('serv-1');
      expect(projectId).toBe('proj-2');

      prismaMock.service.findUnique.mockResolvedValue(null);
      await expect(service.getProjectIdForServiceId('serv-2')).rejects.toThrow(NotFoundException);
    });

    it('getProjectIdForPhaseId debería retornar projectId o lanzar error si no existe', async () => {
      prismaMock.phase.findUnique.mockResolvedValue({ service: { projectId: 'proj-3' } });
      const projectId = await service.getProjectIdForPhaseId('phase-1');
      expect(projectId).toBe('proj-3');

      prismaMock.phase.findUnique.mockResolvedValue(null);
      await expect(service.getProjectIdForPhaseId('phase-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Flujo de OTP', () => {
    it('generateOtp debería invalidar OTPs previos y crear uno nuevo', async () => {
      prismaMock.otpCode.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.otpCode.create.mockResolvedValue({ id: 'otp-1' });

      const res = await service.generateOtp('user@gmt.cl');
      expect(res.success).toBe(true);
      expect(prismaMock.otpCode.updateMany).toHaveBeenCalledWith({
        where: { email: 'user@gmt.cl', consumedAt: null },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
      expect(prismaMock.otpCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'user@gmt.cl',
          codeHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
      expect(emailServiceMock.send).toHaveBeenCalled();
    });

    it('verifyOtp debería arrojar BadRequest si no se generó OTP', async () => {
      prismaMock.otpCode.findFirst.mockResolvedValue(null);
      await expect(service.verifyOtp('user@gmt.cl', '123456')).rejects.toThrow(BadRequestException);
    });

    it('verifyOtp debería marcar como consumido y arrojar error si el código expiró', async () => {
      prismaMock.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() - 10000), // Expirado hace 10s
        attempts: 0,
      });

      await expect(service.verifyOtp('user@gmt.cl', '123456')).rejects.toThrow('El código OTP ha expirado.');
      expect(prismaMock.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
    });

    it('verifyOtp debería arrojar error si se excedió el número máximo de intentos', async () => {
      prismaMock.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 10000),
        attempts: 5,
      });

      await expect(service.verifyOtp('user@gmt.cl', '123456')).rejects.toThrow('Demasiados intentos fallidos.');
    });

    it('verifyOtp debería incrementar intentos si el código es incorrecto', async () => {
      prismaMock.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 10000),
        attempts: 2,
        codeHash: 'somehash', // no va a coincidir
      });

      await expect(service.verifyOtp('user@gmt.cl', '123456')).rejects.toThrow('Código OTP incorrecto.');
      expect(prismaMock.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('verifyOtp debería retornar true e invalidar el OTP cuando es correcto', async () => {
      const otp = '999999';
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(otp).digest('hex');

      prismaMock.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 10000),
        attempts: 2,
        codeHash: hash,
      });

      const res = await service.verifyOtp('user@gmt.cl', otp);
      expect(res).toBe(true);
      expect(prismaMock.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
    });
  });

  describe('saveDataPoints', () => {
    it('debería retornar éxito si el array está vacío', async () => {
      const result = await service.saveDataPoints('user-1', []);
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it('debería lanzar error si el usuario no existe', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.saveDataPoints('user-1', [{
        value: '10.5',
        variableId: 'var-1',
        phaseId: 'phase-1',
      } as SaveDataPointDto])).rejects.toThrow(UnauthorizedException);
    });

    it('debería guardar datapoints y otorgar puntos si tiene permisos', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.variable.findMany.mockResolvedValue([{ id: 'var-1' }]);
      prismaMock.phase.findMany.mockResolvedValue([{ id: 'phase-1', service: { projectId: 'proj-1' } }]);
      prismaMock.element.findMany.mockResolvedValue([{ id: 'el-1' }]);

      prismaMock.dataPoint.createManyAndReturn.mockResolvedValue([{ id: 'dp-1', value: '10.5' }]);
      fgaServiceMock.check.mockResolvedValue(true); // Permitido

      const points: SaveDataPointDto[] = [{
        value: '10.5',
        variableId: 'var-1',
        elementId: 'el-1',
        phaseId: 'phase-1',
      }];

      const res = await service.saveDataPoints('user-1', points);
      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(prismaMock.dataPoint.createManyAndReturn).toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { points: { increment: 15 } },
      });
      expect(prismaMock.pointsLog.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', action: 'MEASUREMENT_UPLOAD', points: 15 },
      });
    });

    it('debería lanzar ForbiddenException si FGA rechaza el permiso', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prismaMock.variable.findMany.mockResolvedValue([{ id: 'var-1' }]);
      prismaMock.phase.findMany.mockResolvedValue([{ id: 'phase-1', service: { projectId: 'proj-1' } }]);
      prismaMock.element.findMany.mockResolvedValue([{ id: 'el-1' }]);

      fgaServiceMock.check.mockResolvedValue(false); // Denegado por FGA

      const points: SaveDataPointDto[] = [{
        value: '10.5',
        variableId: 'var-1',
        elementId: 'el-1',
        phaseId: 'phase-1',
      }];

      await expect(service.saveDataPoints('user-1', points)).rejects.toThrow(ForbiddenException);
    });
  });
});
