import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MetricsService } from '../../src/modules/metrics/metrics.service';
import { OtpService } from '../../src/common/otp.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { EmailService } from '../../src/common/email.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { CreateElementDto, SaveDataPointDto } from '../../src/modules/metrics/dto/metrics.dto';

describe('MetricsService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let emailServiceMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fgaServiceMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storageServiceMock: any;
  let service: MetricsService;

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn((ops: unknown[] | ((tx: unknown) => unknown)) => {
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
        create: vi.fn(),
        update: vi.fn(),
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

    // Storage genérico (no-R2): al no ser instancia de R2StorageService, el servicio
    // usa el camino local por defecto (token + disco), como antes de integrar R2.
    storageServiceMock = {
      save: vi.fn(() => Promise.resolve({ key: 'k', url: 'http://localhost:3001/files/k' })),
      read: vi.fn(() => Promise.resolve(Buffer.from(''))),
      delete: vi.fn(() => Promise.resolve()),
    };

    // El flujo OTP delega en OtpService (general, aislado por `purpose`). Se le pasa
    // el MISMO prismaMock, así las aserciones sobre otpCode.* siguen aplicando y se
    // verifica que la delegación preserva el comportamiento del flujo de métricas.
    const otpService = new OtpService(prismaMock as unknown as PrismaService);

    service = new MetricsService(
      prismaMock as unknown as PrismaService,
      emailServiceMock as unknown as EmailService,
      fgaServiceMock as unknown as FgaService,
      storageServiceMock as unknown as StorageService,
      otpService,
    );
  });

  describe('createPool (anti-hijack de elementos entre proyectos)', () => {
    const dto: CreateElementDto = {
      code: 'R1',
      name: 'Reservorio 1',
      type: 'RESERVORIO',
      projectId: 'proj-A',
    };

    beforeEach(() => {
      prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-A' });
      prismaMock.element.create.mockResolvedValue({ id: 'el-1', ...dto });
      prismaMock.element.update.mockResolvedValue({ id: 'el-1', ...dto });
    });

    it('crea el elemento cuando el código no existe, sin chequeo FGA adicional', async () => {
      prismaMock.element.findUnique.mockResolvedValue(null);

      const res = await service.createPool('user-1', dto);

      expect(res.id).toBe('el-1');
      expect(prismaMock.element.create).toHaveBeenCalled();
      expect(fgaServiceMock.check).not.toHaveBeenCalled();
    });

    it('actualiza el elemento cuando ya pertenece al mismo proyecto, sin chequeo FGA adicional', async () => {
      prismaMock.element.findUnique.mockResolvedValue({ id: 'el-1', projectId: 'proj-A' });

      await service.createPool('user-1', dto);

      expect(prismaMock.element.update).toHaveBeenCalled();
      expect(prismaMock.element.create).not.toHaveBeenCalled();
      expect(fgaServiceMock.check).not.toHaveBeenCalled();
    });

    it('rechaza con 409 el intento de hijack: código de un elemento de OTRO proyecto sin permiso allí', async () => {
      // Escenario adversarial: el elemento R1 vive en proj-B (otro proyecto, incluso
      // otro cliente); el usuario solo tiene can_submit_measurements en proj-A.
      prismaMock.element.findUnique.mockResolvedValue({ id: 'el-1', projectId: 'proj-B' });
      fgaServiceMock.check.mockImplementation(({ object }: { object: string }) =>
        Promise.resolve(object === 'project:proj-A'),
      );

      await expect(service.createPool('user-1', dto)).rejects.toThrow(ConflictException);
      // El elemento de proj-B NO debe re-apuntarse ni tocarse.
      expect(prismaMock.element.update).not.toHaveBeenCalled();
      expect(prismaMock.element.create).not.toHaveBeenCalled();
    });

    it('permite re-apuntar el elemento solo si el usuario también tiene permiso en el proyecto de origen', async () => {
      prismaMock.element.findUnique.mockResolvedValue({ id: 'el-1', projectId: 'proj-B' });
      fgaServiceMock.check.mockResolvedValue(true);

      await service.createPool('user-1', dto);

      expect(fgaServiceMock.check).toHaveBeenCalledWith({
        user: 'user:user-1',
        relation: 'can_submit_measurements',
        object: 'project:proj-B',
      });
      expect(prismaMock.element.update).toHaveBeenCalled();
    });

    it('cierra el TOCTOU: si el code aparece en la ventana (P2002), re-valida antes de re-apuntar', async () => {
      // El code no existe al chequear (create), pero otra tx lo insertó en proj-B en la
      // ventana → P2002. Se re-lee y se exige permiso en proj-B antes de re-apuntar.
      prismaMock.element.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'el-1', projectId: 'proj-B' });
      prismaMock.element.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      fgaServiceMock.check.mockResolvedValue(false);

      await expect(service.createPool('user-1', dto)).rejects.toThrow(ConflictException);
      expect(prismaMock.element.update).not.toHaveBeenCalled();
    });
  });

  describe('updatePool (anti-hijack de elementos entre proyectos)', () => {
    const dto: CreateElementDto = {
      code: 'R1',
      name: 'Reservorio 1 (editado)',
      type: 'RESERVORIO',
      projectId: 'proj-A',
    };

    // findUnique se usa por id (getPoolById) y por code (colisión); despacha según el where.
    const mockElements = (
      byId: Record<string, { id: string; code: string; projectId: string }>,
      byCode: Record<string, { id: string; projectId: string }>,
    ) => {
      prismaMock.element.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; code?: string } }) => {
          if (where.id !== undefined) return Promise.resolve(byId[where.id] ?? null);
          if (where.code !== undefined) return Promise.resolve(byCode[where.code] ?? null);
          return Promise.resolve(null);
        },
      );
    };

    beforeEach(() => {
      prismaMock.element.update.mockResolvedValue({ id: 'el-1', ...dto });
    });

    it('rechaza con 403 la edición de un elemento de OTRO proyecto aunque dto.projectId apunte al propio', async () => {
      // Escenario adversarial: el elemento el-B vive en proj-B; el usuario solo tiene
      // can_submit_measurements en proj-A y manda dto.projectId=proj-A para colarse.
      mockElements({ 'el-B': { id: 'el-B', code: 'RB', projectId: 'proj-B' } }, {});
      fgaServiceMock.check.mockImplementation(({ object }: { object: string }) =>
        Promise.resolve(object === 'project:proj-A'),
      );

      await expect(service.updatePool('user-1', 'el-B', dto)).rejects.toThrow(ForbiddenException);
      // El gate debe evaluarse sobre el proyecto REAL del elemento, no el del dto.
      expect(fgaServiceMock.check).toHaveBeenCalledWith({
        user: 'user:user-1',
        relation: 'can_submit_measurements',
        object: 'project:proj-B',
      });
      expect(prismaMock.element.update).not.toHaveBeenCalled();
    });

    it('edita el elemento cuando el usuario tiene permiso en su proyecto real', async () => {
      mockElements(
        { 'el-1': { id: 'el-1', code: 'R1', projectId: 'proj-A' } },
        { R1: { id: 'el-1', projectId: 'proj-A' } },
      );

      const res = await service.updatePool('user-1', 'el-1', dto);

      expect(res.id).toBe('el-1');
      expect(prismaMock.element.update).toHaveBeenCalledWith({
        where: { id: 'el-1' },
        data: expect.objectContaining({ code: 'R1', name: 'Reservorio 1 (editado)' }),
      });
    });

    it('rechaza con 409 el cambio de code a uno que ya usa OTRO elemento', async () => {
      // Renombrar por id nunca puede absorber otro elemento (code es único global):
      // sin este gate, la colisión revienta como error 500 de Prisma (P2002).
      mockElements(
        { 'el-1': { id: 'el-1', code: 'R1', projectId: 'proj-A' } },
        { R2: { id: 'el-2', projectId: 'proj-B' } },
      );

      await expect(service.updatePool('user-1', 'el-1', { ...dto, code: 'R2' })).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.element.update).not.toHaveBeenCalled();
    });
  });

  describe('saveReservorioMetadata (anti-hijack de elementos entre proyectos)', () => {
    const body = {
      reservorio_codigo: 'R1',
      nombre: 'Reservorio 1',
      proyecto_id: 'proj-A',
    };

    beforeEach(() => {
      prismaMock.element.upsert.mockResolvedValue({ id: 'el-1', code: 'R1' });
    });

    it('hace upsert cuando el código no existe, con un solo chequeo FGA (proyecto destino)', async () => {
      prismaMock.element.findUnique.mockResolvedValue(null);

      const res = await service.saveReservorioMetadata('user-1', body);

      expect(res.success).toBe(true);
      expect(prismaMock.element.upsert).toHaveBeenCalled();
      expect(fgaServiceMock.check).toHaveBeenCalledTimes(1);
    });

    it('rechaza con 409 el intento de hijack: código de un elemento de OTRO proyecto sin permiso allí', async () => {
      // Escenario adversarial: R1 vive en proj-B; el usuario solo tiene permiso en
      // proj-A. La rama update del upsert tocaría name/metadata del elemento ajeno.
      prismaMock.element.findUnique.mockResolvedValue({ projectId: 'proj-B' });
      fgaServiceMock.check.mockImplementation(({ object }: { object: string }) =>
        Promise.resolve(object === 'project:proj-A'),
      );

      await expect(service.saveReservorioMetadata('user-1', body)).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.element.upsert).not.toHaveBeenCalled();
    });

    it('permite actualizar el elemento de otro proyecto solo si también tiene permiso allí', async () => {
      prismaMock.element.findUnique.mockResolvedValue({ projectId: 'proj-B' });
      fgaServiceMock.check.mockResolvedValue(true);

      await service.saveReservorioMetadata('user-1', body);

      expect(fgaServiceMock.check).toHaveBeenCalledWith({
        user: 'user:user-1',
        relation: 'can_submit_measurements',
        object: 'project:proj-B',
      });
      expect(prismaMock.element.upsert).toHaveBeenCalled();
    });

    it('actualiza sin chequeo adicional cuando el código ya vive en el proyecto destino', async () => {
      prismaMock.element.findUnique.mockResolvedValue({ projectId: 'proj-A' });

      await service.saveReservorioMetadata('user-1', body);

      expect(fgaServiceMock.check).toHaveBeenCalledTimes(1);
      expect(prismaMock.element.upsert).toHaveBeenCalled();
    });
  });

  describe('getDemGrid (visor 3D con DEM real)', () => {
    it('lanza NotFound si la poza no tiene DEM registrado', async () => {
      prismaMock.element.findUnique.mockResolvedValue({
        id: 'el-1',
        project: { services: [{ id: 's-1' }] },
      });
      prismaMock.dataPoint.findFirst.mockResolvedValue(null);
      await expect(service.getDemGrid({ reservorio_codigo: 'R1' })).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFound si el almacenamiento no es R2 (no hay lectura por rangos en dev)', async () => {
      prismaMock.element.findUnique.mockResolvedValue({
        id: 'el-1',
        project: { services: [{ id: 's-1' }] },
      });
      prismaMock.dataPoint.findFirst.mockResolvedValue({
        fileUrl: 'dems/R1/MDE_R1.tif',
        value: 'MDE_R1.tif',
      });
      await expect(service.getDemGrid({ reservorio_codigo: 'R1' })).rejects.toThrow(/R2/);
    });
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
        where: { email: 'user@gmt.cl', purpose: 'METRICS_NONREPUDIATION', consumedAt: null },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
      expect(prismaMock.otpCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'user@gmt.cl',
          purpose: 'METRICS_NONREPUDIATION',
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

    it('verifyOtp debería arrojar error si se excedió el número máximo de intentos (código incorrecto)', async () => {
      const crypto = await import('crypto');
      // Hash de OTRO código: el gate de intentos solo aplica a códigos incorrectos.
      const hash = crypto.createHash('sha256').update('999999').digest('hex');
      prismaMock.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(Date.now() + 10000),
        attempts: 5,
        codeHash: hash,
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
