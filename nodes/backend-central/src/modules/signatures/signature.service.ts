import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { OtpService, OTP_PURPOSES } from '../../common/otp.service';
import { EmailService } from '../../common/email.service';
import { checklistSignatureCodeEmail } from '../../common/email-templates';
import { resolvePasswordOtpTarget } from '../../common/email-target';
import { maskEmail } from '../../common/mask-email';
import { PrismaService } from '../../prisma/prisma.service';
import { WebAuthnService } from './webauthn.service';

/** Método de firma. */
export type SignatureMethod = 'WEBAUTHN' | 'EMAIL_OTP';

/** Firma entrante del cliente: biométrica (aserción) o por código al correo. */
export type IncomingSignature =
  | { method: 'WEBAUTHN'; response: AuthenticationResponseJSON }
  | { method: 'EMAIL_OTP'; code: string };

/** Material verificado de una firma, para persistir como `SignatureProof`. */
export interface VerifiedSignature {
  method: SignatureMethod;
  credentialId: string | null;
  deviceName: string | null;
  signature: Uint8Array<ArrayBuffer> | null;
  authenticatorData: Uint8Array<ArrayBuffer> | null;
  clientDataJSON: Uint8Array<ArrayBuffer> | null;
}

/**
 * Orquesta la firma verificada (#68 Fase 2), reutilizable por contexto (checklist
 * hoy; documentos mañana). Dos vías que producen la misma prueba ligada al
 * `contentHash`: biometría (WebAuthn) o código al correo (OTP, reusa la infra de #66).
 */
@Injectable()
export class SignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webauthn: WebAuthnService,
    private readonly otp: OtpService,
    private readonly email: EmailService,
  ) {}

  /** ¿El usuario tiene biometría disponible? (el front elige biometría vs correo). */
  hasBiometric(userId: string): Promise<boolean> {
    return this.webauthn.hasCredentials(userId);
  }

  /** Opciones para firmar con biometría el contenido dado (delegado en WebAuthn). */
  generateWebAuthnSignOptions(
    userId: string,
    originHeader: string | undefined,
    contextType: string,
    contentHash: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return this.webauthn.generateSignOptions(userId, originHeader, contextType, contentHash);
  }

  /** Envía un OTP al correo para firmar por código (fallback). Devuelve el correo enmascarado. */
  async startOtpSignature(
    userId: string,
    contextType: string,
    contentHash: string,
  ): Promise<{ maskedEmail: string }> {
    const target = await this.resolveTarget(userId);
    // Sesión ligada al contenido: el código solo firma ESTE contenido.
    await this.webauthn.storeSignSession(userId, contextType, contentHash);
    const code = await this.otp.generate(target, OTP_PURPOSES.SIGN_CHECKLIST);
    await this.email.send({ to: target, ...checklistSignatureCodeEmail(code) });
    return { maskedEmail: maskEmail(target) };
  }

  /**
   * Verifica la firma entrante contra el `contentHash`. Devuelve el material a
   * persistir. No persiste nada: el llamador crea el `SignatureProof` dentro de su
   * propia transacción (atómico con el artefacto firmado).
   */
  async verify(
    userId: string,
    originHeader: string | undefined,
    contextType: string,
    contentHash: string,
    signature: IncomingSignature,
  ): Promise<VerifiedSignature> {
    if (signature.method === 'WEBAUTHN') {
      if (!signature.response || typeof signature.response !== 'object') {
        throw new BadRequestException('Falta la firma biométrica.');
      }
      const proof = await this.webauthn.verifySignAssertion(
        userId,
        originHeader,
        contextType,
        contentHash,
        signature.response,
      );
      return {
        method: 'WEBAUTHN',
        credentialId: proof.credentialId,
        deviceName: proof.deviceName,
        signature: proof.signature,
        authenticatorData: proof.authenticatorData,
        clientDataJSON: proof.clientDataJSON,
      };
    }
    if (signature.method !== 'EMAIL_OTP') {
      throw new BadRequestException('Método de firma inválido.');
    }
    if (typeof signature.code !== 'string' || !/^\d{6}$/.test(signature.code)) {
      throw new BadRequestException('Ingresa el código de 6 dígitos para firmar.');
    }
    // EMAIL_OTP: se verifica el código PRIMERO (permite reintentos ante un typo sin
    // quemar la sesión), y solo entonces se consume la sesión ligada al contenido.
    const target = await this.resolveTarget(userId);
    await this.otp.verify(target, OTP_PURPOSES.SIGN_CHECKLIST, signature.code);
    await this.webauthn.consumeSignSession(userId, contextType, contentHash);
    return {
      method: 'EMAIL_OTP',
      credentialId: null,
      deviceName: null,
      signature: null,
      authenticatorData: null,
      clientDataJSON: null,
    };
  }

  /** Correo destino del OTP de firma (mismo criterio que #66). */
  private async resolveTarget(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        emailInstitucional: true,
        emailPersonal: true,
        emailInstitucionalVerified: true,
        emailPersonalVerified: true,
      },
    });
    if (!user) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }
    const target = resolvePasswordOtpTarget(user);
    if (!target || target.trim().length === 0) {
      throw new ConflictException(
        'No podemos enviarte el código para firmar: tu cuenta no tiene un correo válido. Contacta a un administrador.',
      );
    }
    return target;
  }
}
