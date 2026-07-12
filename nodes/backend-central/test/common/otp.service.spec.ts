import 'reflect-metadata';
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OtpService, OTP_PURPOSES } from '../../src/common/otp.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/** SHA-256 hex, igual que el servicio, para fabricar hashes de prueba. */
function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Fila OtpCode mínima que el servicio consulta. */
interface OtpRow {
  id: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

interface OtpPrismaMock {
  $transaction: ReturnType<typeof vi.fn>;
  otpCode: {
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

describe('OtpService', () => {
  let prismaMock: OtpPrismaMock;
  let service: OtpService;

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
      otpCode: {
        updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
        create: vi.fn(() => Promise.resolve({ id: 'otp-1' })),
        findFirst: vi.fn(),
        update: vi.fn(() => Promise.resolve({})),
      },
    };
    service = new OtpService(prismaMock as unknown as PrismaService);
  });

  describe('generate', () => {
    it('devuelve un código de 6 dígitos, invalida el activo previo y crea uno nuevo con el purpose', async () => {
      const code = await service.generate('user@gmt.cl', OTP_PURPOSES.CHANGE_EMAIL);

      expect(code).toMatch(/^\d{6}$/);
      expect(prismaMock.otpCode.updateMany).toHaveBeenCalledWith({
        where: { email: 'user@gmt.cl', purpose: 'CHANGE_EMAIL', consumedAt: null },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
      expect(prismaMock.otpCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'user@gmt.cl',
          purpose: 'CHANGE_EMAIL',
          codeHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('persiste el hash del código, nunca el código en claro', async () => {
      const code = await service.generate('user@gmt.cl', OTP_PURPOSES.CHANGE_PASSWORD);

      const created = prismaMock.otpCode.create.mock.calls[0]?.[0] as {
        data: { codeHash: string };
      };
      expect(created.data.codeHash).toBe(hashOtp(code));
      expect(created.data.codeHash).not.toBe(code);
    });

    it('aísla por purpose: el filtro de invalidación usa el purpose recibido', async () => {
      await service.generate('user@gmt.cl', OTP_PURPOSES.METRICS_NONREPUDIATION);

      expect(prismaMock.otpCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ purpose: 'METRICS_NONREPUDIATION' }),
        }),
      );
    });
  });

  describe('verify', () => {
    it('filtra el OTP activo por (email, purpose)', async () => {
      prismaMock.otpCode.findFirst.mockResolvedValue(null);

      await expect(
        service.verify('user@gmt.cl', OTP_PURPOSES.CHANGE_EMAIL, '123456'),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.otpCode.findFirst).toHaveBeenCalledWith({
        where: { email: 'user@gmt.cl', purpose: 'CHANGE_EMAIL', consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('lanza BadRequest si no hay OTP activo', async () => {
      prismaMock.otpCode.findFirst.mockResolvedValue(null);
      await expect(
        service.verify('user@gmt.cl', OTP_PURPOSES.CHANGE_PASSWORD, '123456'),
      ).rejects.toThrow('No se ha generado ningún código OTP para este correo.');
    });

    it('consume y falla si el código expiró', async () => {
      const row: OtpRow = {
        id: 'otp-1',
        codeHash: hashOtp('123456'),
        expiresAt: new Date(Date.now() - 10_000),
        attempts: 0,
      };
      prismaMock.otpCode.findFirst.mockResolvedValue(row);

      await expect(
        service.verify('user@gmt.cl', OTP_PURPOSES.CHANGE_EMAIL, '123456'),
      ).rejects.toThrow('El código OTP ha expirado.');
      expect(prismaMock.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
    });

    it('lanza lockout tras 5 intentos fallidos', async () => {
      const row: OtpRow = {
        id: 'otp-1',
        codeHash: hashOtp('123456'),
        expiresAt: new Date(Date.now() + 10_000),
        attempts: 5,
      };
      prismaMock.otpCode.findFirst.mockResolvedValue(row);

      await expect(
        service.verify('user@gmt.cl', OTP_PURPOSES.CHANGE_EMAIL, '123456'),
      ).rejects.toThrow('Demasiados intentos fallidos. Solicita un nuevo código.');
    });

    it('incrementa intentos si el código es incorrecto', async () => {
      const row: OtpRow = {
        id: 'otp-1',
        codeHash: hashOtp('999999'),
        expiresAt: new Date(Date.now() + 10_000),
        attempts: 2,
      };
      prismaMock.otpCode.findFirst.mockResolvedValue(row);

      await expect(
        service.verify('user@gmt.cl', OTP_PURPOSES.CHANGE_EMAIL, '123456'),
      ).rejects.toThrow('Código OTP incorrecto.');
      expect(prismaMock.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('trata un hash almacenado de longitud distinta como no-match sin lanzar error inesperado', async () => {
      const row: OtpRow = {
        id: 'otp-1',
        // Hash malformado: al decodificar hex da una longitud en bytes distinta
        // a la del SHA-256 esperado, ejercitando la rama de longitud desigual de
        // la comparación en tiempo constante (no debe crashear).
        codeHash: 'abcd',
        expiresAt: new Date(Date.now() + 10_000),
        attempts: 0,
      };
      prismaMock.otpCode.findFirst.mockResolvedValue(row);

      await expect(
        service.verify('user@gmt.cl', OTP_PURPOSES.CHANGE_EMAIL, '123456'),
      ).rejects.toThrow('Código OTP incorrecto.');
      expect(prismaMock.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('devuelve true y consume el OTP cuando el código es correcto', async () => {
      const code = '654321';
      const row: OtpRow = {
        id: 'otp-1',
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + 10_000),
        attempts: 1,
      };
      prismaMock.otpCode.findFirst.mockResolvedValue(row);

      const ok = await service.verify('user@gmt.cl', OTP_PURPOSES.CHANGE_PASSWORD, code);

      expect(ok).toBe(true);
      expect(prismaMock.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      });
    });
  });
});
