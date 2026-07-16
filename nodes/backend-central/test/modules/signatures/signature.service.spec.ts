import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignatureService } from '../../../src/modules/signatures/signature.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { WebAuthnService } from '../../../src/modules/signatures/webauthn.service';
import type { OtpService } from '../../../src/common/otp.service';
import type { EmailService } from '../../../src/common/email.service';

const CTX = 'CHECKLIST_SUBMISSION';
const HASH = 'abc123hash';

interface Mocks {
  service: SignatureService;
  userFindUnique: ReturnType<typeof vi.fn>;
  hasCredentials: ReturnType<typeof vi.fn>;
  storeSignSession: ReturnType<typeof vi.fn>;
  consumeSignSession: ReturnType<typeof vi.fn>;
  verifySignAssertion: ReturnType<typeof vi.fn>;
  otpGenerate: ReturnType<typeof vi.fn>;
  otpVerify: ReturnType<typeof vi.fn>;
  emailSend: ReturnType<typeof vi.fn>;
}

function build(userOverrides: Record<string, unknown> | null = {}): Mocks {
  const userFindUnique = vi.fn(() =>
    Promise.resolve(
      userOverrides === null
        ? null
        : {
            email: 'fperez@gmt.cl',
            emailInstitucional: 'felipe.perez@gmt.cl',
            emailPersonal: null,
            emailInstitucionalVerified: new Date(),
            emailPersonalVerified: null,
            ...userOverrides,
          },
    ),
  );
  const hasCredentials = vi.fn(() => Promise.resolve(true));
  const storeSignSession = vi.fn(() => Promise.resolve());
  const consumeSignSession = vi.fn(() => Promise.resolve('challenge'));
  const verifySignAssertion = vi.fn(() =>
    Promise.resolve({
      credentialId: 'CREDID',
      deviceName: 'Celular',
      signature: new Uint8Array([1]),
      authenticatorData: new Uint8Array([2]),
      clientDataJSON: new Uint8Array([3]),
    }),
  );
  const otpGenerate = vi.fn(() => Promise.resolve('123456'));
  const otpVerify = vi.fn(() => Promise.resolve(true));
  const emailSend = vi.fn(() => Promise.resolve());

  const prisma = { user: { findUnique: userFindUnique } } as unknown as PrismaService;
  const webauthn = {
    hasCredentials,
    storeSignSession,
    consumeSignSession,
    verifySignAssertion,
  } as unknown as WebAuthnService;
  const otp = { generate: otpGenerate, verify: otpVerify } as unknown as OtpService;
  const email = { send: emailSend } as unknown as EmailService;

  return {
    service: new SignatureService(prisma, webauthn, otp, email),
    userFindUnique,
    hasCredentials,
    storeSignSession,
    consumeSignSession,
    verifySignAssertion,
    otpGenerate,
    otpVerify,
    emailSend,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('SignatureService.startOtpSignature', () => {
  it('guarda la sesión, genera OTP, lo envía y devuelve el correo enmascarado', async () => {
    const m = build();
    const res = await m.service.startOtpSignature('u1', CTX, HASH);
    expect(m.storeSignSession).toHaveBeenCalledWith('u1', CTX, HASH);
    expect(m.otpGenerate).toHaveBeenCalledWith('felipe.perez@gmt.cl', 'SIGN_CHECKLIST');
    expect(m.emailSend).toHaveBeenCalledTimes(1);
    expect(res.maskedEmail).not.toContain('felipe.perez');
  });

  it('409 si la cuenta no tiene un correo válido', async () => {
    const m = build({ email: '', emailInstitucional: null, emailPersonal: null });
    await expect(m.service.startOtpSignature('u1', CTX, HASH)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SignatureService.verify', () => {
  it('WEBAUTHN: delega en la verificación biométrica y devuelve el material', async () => {
    const m = build();
    const proof = await m.service.verify('u1', 'https://x', CTX, HASH, {
      method: 'WEBAUTHN',
      response: { id: 'CREDID' } as never,
    });
    expect(m.verifySignAssertion).toHaveBeenCalledWith('u1', 'https://x', CTX, HASH, {
      id: 'CREDID',
    });
    expect(proof.method).toBe('WEBAUTHN');
    expect(proof.credentialId).toBe('CREDID');
    expect(proof.signature).toBeInstanceOf(Uint8Array);
  });

  it('WEBAUTHN: rechaza si falta la aserción', async () => {
    const m = build();
    await expect(
      m.service.verify('u1', 'https://x', CTX, HASH, { method: 'WEBAUTHN' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.verifySignAssertion).not.toHaveBeenCalled();
  });

  it('EMAIL_OTP: verifica el código PRIMERO y luego consume la sesión', async () => {
    const m = build();
    const proof = await m.service.verify('u1', undefined, CTX, HASH, {
      method: 'EMAIL_OTP',
      code: '654321',
    });
    expect(m.otpVerify).toHaveBeenCalledWith('felipe.perez@gmt.cl', 'SIGN_CHECKLIST', '654321');
    expect(m.consumeSignSession).toHaveBeenCalledWith('u1', CTX, HASH);
    expect(proof.method).toBe('EMAIL_OTP');
    expect(proof.credentialId).toBeNull();
    // La sesión se consume DESPUÉS de validar el código (un typo no la quema).
    const otpOrder = m.otpVerify.mock.invocationCallOrder[0] ?? 0;
    const consumeOrder = m.consumeSignSession.mock.invocationCallOrder[0] ?? 0;
    expect(otpOrder).toBeGreaterThan(0);
    expect(otpOrder).toBeLessThan(consumeOrder);
  });

  it('EMAIL_OTP: rechaza un código con formato inválido sin verificar', async () => {
    const m = build();
    await expect(
      m.service.verify('u1', undefined, CTX, HASH, { method: 'EMAIL_OTP', code: 'abc' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.otpVerify).not.toHaveBeenCalled();
  });

  it('rechaza un método desconocido', async () => {
    const m = build();
    await expect(
      m.service.verify('u1', undefined, CTX, HASH, { method: 'OTRO' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
