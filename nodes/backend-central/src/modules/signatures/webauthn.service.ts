import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { PrismaService } from '../../prisma/prisma.service';
import { RP_NAME, resolveRp } from './webauthn.config';

/** Material de una firma biométrica verificada, para persistir como prueba. */
export interface WebAuthnSignatureProof {
  credentialId: string;
  deviceName: string | null;
  signature: Uint8Array<ArrayBuffer>;
  authenticatorData: Uint8Array<ArrayBuffer>;
  clientDataJSON: Uint8Array<ArrayBuffer>;
}

/**
 * Decodifica base64url a un `Uint8Array<ArrayBuffer>` con backing NO compartido
 * (lo exige el tipo de entrada Bytes de Prisma). Se copia sobre un ArrayBuffer nuevo.
 */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, 'base64url');
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/** TTL de un desafío WebAuthn: 5 minutos. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Máximo de dispositivos registrados por usuario (evita agotamiento de recursos). */
const MAX_CREDENTIALS_PER_USER = 20;
/** Propósitos de desafío. */
export const CHALLENGE_PURPOSES = { REGISTER: 'REGISTER', SIGN: 'SIGN' } as const;

/** Vista de un dispositivo registrado (sin exponer la llave). */
export interface WebAuthnDeviceView {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Ceremonias WebAuthn de REGISTRO (#68, Fase 1). Genera las opciones de registro,
 * guarda el desafío de un solo uso y verifica la respuesta del autenticador para
 * persistir la llave pública. También lista y elimina los dispositivos del usuario.
 */
@Injectable()
export class WebAuthnService {
  constructor(private readonly prisma: PrismaService) {}

  /** Opciones para registrar un dispositivo nuevo (el front las pasa a startRegistration). */
  async generateRegistrationOptions(
    userId: string,
    originHeader: string | undefined,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { rpID } = resolveRp(originHeader);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, firstName: true, lastName: true },
    });
    if (!user) {
      throw new NotFoundException('El usuario de la sesión ya no existe.');
    }
    const existing = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: user.username,
      userDisplayName: `${user.firstName} ${user.lastName}`.trim(),
      // userID debe ser un BufferSource en v13; el id de la cuenta es estable.
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      // Evita registrar dos veces el mismo autenticador.
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: this.parseTransports(c.transports),
      })),
      // Exige verificación de usuario (biometría/PIN) y prefiere passkeys de plataforma.
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    await this.storeChallenge(userId, options.challenge, CHALLENGE_PURPOSES.REGISTER);
    return options;
  }

  /** Verifica la respuesta de registro y persiste la llave pública del dispositivo. */
  async verifyRegistration(
    userId: string,
    originHeader: string | undefined,
    response: RegistrationResponseJSON,
    deviceName: string | undefined,
  ): Promise<WebAuthnDeviceView> {
    const { origin, rpID } = resolveRp(originHeader);
    const expectedChallenge = await this.consumeChallenge(userId, CHALLENGE_PURPOSES.REGISTER);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      throw new BadRequestException('No se pudo verificar el registro del dispositivo.');
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('El registro del dispositivo no pudo verificarse.');
    }

    const { credential } = verification.registrationInfo;
    // Tope de dispositivos por usuario: evita el agotamiento por registro ilimitado.
    const count = await this.prisma.webAuthnCredential.count({ where: { userId } });
    if (count >= MAX_CREDENTIALS_PER_USER) {
      throw new ConflictException(
        `Alcanzaste el máximo de ${MAX_CREDENTIALS_PER_USER} dispositivos registrados. Elimina uno para agregar otro.`,
      );
    }
    // credentialId único: si el dispositivo ya estaba registrado, no duplicar (ruta amable).
    const dup = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: credential.id },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException('Este dispositivo ya está registrado.');
    }

    let created;
    try {
      created = await this.prisma.webAuthnCredential.create({
        data: {
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports?.join(',') ?? null,
          deviceName: this.cleanDeviceName(deviceName),
        },
        select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
      });
    } catch (error: unknown) {
      // Carrera: dos registros concurrentes del mismo autenticador. El índice único
      // preserva la integridad; se mapea a 409 (no 500), igual que el resto del repo.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Este dispositivo ya está registrado.');
      }
      throw error;
    }
    return this.toView(created);
  }

  /* --------------------------------- firma ---------------------------------- */

  /** ¿El usuario tiene al menos un dispositivo para firmar con biometría? */
  async hasCredentials(userId: string): Promise<boolean> {
    const count = await this.prisma.webAuthnCredential.count({ where: { userId } });
    return count > 0;
  }

  /**
   * Opciones para FIRMAR con biometría (#68 Fase 2). El desafío ES el `contentHash`,
   * así la aserción cubre criptográficamente el contenido firmado. Lanza si el usuario
   * no tiene dispositivos (el llamador cae al fallback por correo).
   */
  async generateSignOptions(
    userId: string,
    originHeader: string | undefined,
    contextType: string,
    contentHash: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const { rpID } = resolveRp(originHeader);
    const creds = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    if (creds.length === 0) {
      throw new BadRequestException('No tienes un dispositivo registrado para firmar.');
    }
    const options = await generateAuthenticationOptions({
      rpID,
      challenge: contentHash,
      userVerification: 'required',
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: this.parseTransports(c.transports),
      })),
    });
    await this.storeChallenge(userId, options.challenge, CHALLENGE_PURPOSES.SIGN, {
      contextType,
      contextHash: contentHash,
    });
    return options;
  }

  /**
   * Registra una sesión de firma para el camino OTP (sin ceremonia WebAuthn): guarda
   * el `contentHash` como desafío single-use, para verificar luego que el contenido
   * enviado coincide exactamente con el que se autorizó por código.
   */
  async storeSignSession(userId: string, contextType: string, contentHash: string): Promise<void> {
    await this.storeChallenge(userId, contentHash, CHALLENGE_PURPOSES.SIGN, {
      contextType,
      contextHash: contentHash,
    });
  }

  /** Consume (atómico, single-use) la sesión de firma ligada al contextType + contentHash. */
  async consumeSignSession(
    userId: string,
    contextType: string,
    contentHash: string,
  ): Promise<string> {
    const record = await this.prisma.webAuthnChallenge.findFirst({
      where: {
        userId,
        purpose: CHALLENGE_PURPOSES.SIGN,
        contextType,
        contextHash: contentHash,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw new BadRequestException(
        'No hay una firma pendiente para este contenido. Vuelve a intentarlo.',
      );
    }
    const claimed = await this.prisma.webAuthnChallenge.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException(
        'No hay una firma pendiente para este contenido. Vuelve a intentarlo.',
      );
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('La firma expiró. Vuelve a intentarla.');
    }
    return record.challenge;
  }

  /**
   * Verifica una aserción de firma biométrica contra el `contentHash`. Consume la
   * sesión (single-use, ligada al contenido), verifica la aserción con la llave
   * guardada, actualiza el contador anti-clonación y devuelve el material de la prueba.
   */
  async verifySignAssertion(
    userId: string,
    originHeader: string | undefined,
    contextType: string,
    contentHash: string,
    response: AuthenticationResponseJSON,
  ): Promise<WebAuthnSignatureProof> {
    const { origin, rpID } = resolveRp(originHeader);
    const expectedChallenge = await this.consumeSignSession(userId, contextType, contentHash);

    const cred = await this.prisma.webAuthnCredential.findFirst({
      where: { userId, credentialId: response.id },
    });
    if (!cred) {
      throw new BadRequestException('La llave usada para firmar no está registrada a tu nombre.');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(cred.publicKey),
          counter: cred.counter,
          transports: this.parseTransports(cred.transports),
        },
      });
    } catch {
      throw new BadRequestException('No se pudo verificar la firma.');
    }
    if (!verification.verified) {
      throw new BadRequestException('La firma no pudo verificarse.');
    }

    await this.prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });

    return {
      credentialId: cred.credentialId,
      deviceName: cred.deviceName,
      signature: fromBase64Url(response.response.signature),
      authenticatorData: fromBase64Url(response.response.authenticatorData),
      clientDataJSON: fromBase64Url(response.response.clientDataJSON),
    };
  }

  /** Dispositivos registrados por el usuario. */
  async listCredentials(userId: string): Promise<WebAuthnDeviceView[]> {
    const rows = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
    });
    return rows.map((r) => this.toView(r));
  }

  /** Elimina un dispositivo propio (404 si no es del usuario). */
  async deleteCredential(userId: string, id: string): Promise<void> {
    const cred = await this.prisma.webAuthnCredential.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!cred) {
      throw new NotFoundException('No existe ese dispositivo registrado.');
    }
    await this.prisma.webAuthnCredential.delete({ where: { id } });
  }

  /* --------------------------------- helpers -------------------------------- */

  /** Guarda un desafío single-use, invalidando cualquier previo del mismo par. */
  private async storeChallenge(
    userId: string,
    challenge: string,
    purpose: string,
    context?: { contextType: string; contextId?: string; contextHash: string },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.webAuthnChallenge.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.webAuthnChallenge.create({
        data: {
          userId,
          challenge,
          purpose,
          contextType: context?.contextType ?? null,
          contextId: context?.contextId ?? null,
          contextHash: context?.contextHash ?? null,
          expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        },
      }),
    ]);
  }

  /** Consume el desafío activo (single-use), validando expiración. Devuelve el valor. */
  private async consumeChallenge(userId: string, purpose: string): Promise<string> {
    const record = await this.prisma.webAuthnChallenge.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw new BadRequestException('No hay un desafío activo. Vuelve a intentarlo.');
    }
    // Consumo ATÓMICO: el `where` reincluye `consumedAt: null`, así solo UN intento
    // concurrente pasa el desafío de null a fecha (count 1). Un segundo intento con el
    // mismo desafío obtiene count 0 y se rechaza — anti-replay real, sin depender de la
    // lectura previa. Importante para que la Fase 2 (SIGN) no acepte una firma repetida.
    const claimed = await this.prisma.webAuthnChallenge.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('No hay un desafío activo. Vuelve a intentarlo.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('El desafío expiró. Vuelve a intentarlo.');
    }
    return record.challenge;
  }

  private parseTransports(csv: string | null): AuthenticatorTransportFuture[] | undefined {
    if (!csv) return undefined;
    const list = csv
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    return list.length > 0 ? (list as AuthenticatorTransportFuture[]) : undefined;
  }

  private cleanDeviceName(name: string | undefined): string | null {
    const trimmed = (name ?? '').trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, 60);
  }

  private toView(row: {
    id: string;
    deviceName: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }): WebAuthnDeviceView {
    return {
      id: row.id,
      deviceName: row.deviceName,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    };
  }
}
