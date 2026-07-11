import { Injectable, BadRequestException } from '@nestjs/common';
import { randomInt, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** TTL de un OTP: 5 minutos de validez desde su emisión. */
const OTP_TTL_MS = 5 * 60 * 1000;
/** Lockout: tras 5 intentos fallidos el código deja de aceptarse. */
const OTP_MAX_ATTEMPTS = 5;

/**
 * Propósitos conocidos de un OTP. La tabla `OtpCode` es compartida por varios
 * flujos; el `purpose` los aísla (un código de cambio de correo no sirve para
 * autorizar cubicaciones, ni viceversa). El servicio acepta cualquier string,
 * pero estos son los valores canónicos usados en el código.
 */
export const OTP_PURPOSES = {
  /** No-repudio de subida de cubicaciones/datos (flujo de métricas — default de la columna). */
  METRICS_NONREPUDIATION: 'METRICS_NONREPUDIATION',
  /** Verificación de un nuevo correo antes de aplicarlo al perfil. */
  CHANGE_EMAIL: 'CHANGE_EMAIL',
  /** Autorización de un cambio de contraseña. */
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
} as const;

/** SHA-256 hex del código: nunca se persiste el OTP en claro. */
function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

/**
 * Servicio de OTP de uso general (desacoplado de métricas).
 *
 * Genera y verifica códigos de 6 dígitos asociados a un par `(email, purpose)`,
 * con hash SHA-256, TTL de 5 minutos, un único OTP activo por par (el previo se
 * invalida al emitir uno nuevo), lockout a los 5 intentos y consumo único.
 *
 * NO envía correo: `generate` devuelve el código en claro y es el llamador quien
 * decide cómo entregarlo (vía `EmailService`), manteniendo este servicio libre de
 * dependencias de entrega.
 */
@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emite un OTP para `(email, purpose)`: invalida el activo previo de ESE par,
   * persiste el hash + expiración y devuelve el código en claro (6 dígitos).
   */
  async generate(email: string, purpose: string): Promise<string> {
    const otp = randomInt(100000, 1000000).toString();
    const codeHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.$transaction([
      // Un solo OTP activo por (email, purpose): invalida cualquier código previo
      // sin consumir de ese mismo propósito.
      this.prisma.otpCode.updateMany({
        where: { email, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpCode.create({
        data: { email, purpose, codeHash, expiresAt },
      }),
    ]);

    return otp;
  }

  /**
   * Verifica y consume el OTP activo de `(email, purpose)`. Aplica expiración,
   * lockout (5 intentos) y consumo único. Devuelve `true` si el código es válido;
   * lanza `BadRequestException` en cualquier otro caso (sin código, expirado,
   * bloqueado o incorrecto).
   */
  async verify(email: string, purpose: string, code: string): Promise<boolean> {
    const record = await this.prisma.otpCode.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw new BadRequestException('No se ha generado ningún código OTP para este correo.');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('El código OTP ha expirado.');
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Demasiados intentos fallidos. Solicita un nuevo código.');
    }

    if (record.codeHash !== hashOtp(code)) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Código OTP incorrecto.');
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }
}
