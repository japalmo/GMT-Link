import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de las ceremonias de SimpleWebAuthn: no hay autenticador real en el test.
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { WebAuthnService } from '../../../src/modules/signatures/webauthn.service';
import type { PrismaService } from '../../../src/prisma/prisma.service';

const ORIGIN = 'https://gmt-link.gmtingenieria.com';

interface Mocks {
  service: WebAuthnService;
  userFindUnique: ReturnType<typeof vi.fn>;
  credFindMany: ReturnType<typeof vi.fn>;
  credFindUnique: ReturnType<typeof vi.fn>;
  credFindFirst: ReturnType<typeof vi.fn>;
  credCount: ReturnType<typeof vi.fn>;
  credCreate: ReturnType<typeof vi.fn>;
  credDelete: ReturnType<typeof vi.fn>;
  credUpdate: ReturnType<typeof vi.fn>;
  chalUpdateMany: ReturnType<typeof vi.fn>;
  chalCreate: ReturnType<typeof vi.fn>;
  chalFindFirst: ReturnType<typeof vi.fn>;
}

function build(): Mocks {
  const userFindUnique = vi.fn(() =>
    Promise.resolve({ username: 'fperez', firstName: 'Felipe', lastName: 'Pérez' }),
  );
  const credFindMany = vi.fn(() => Promise.resolve([]));
  const credFindUnique = vi.fn(() => Promise.resolve(null));
  const credFindFirst = vi.fn(() => Promise.resolve(null));
  const credCount = vi.fn(() => Promise.resolve(0));
  const credCreate = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'dev-1',
      deviceName: (args.data.deviceName as string) ?? null,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      lastUsedAt: null,
    }),
  );
  const credDelete = vi.fn(() => Promise.resolve({}));
  const credUpdate = vi.fn(() => Promise.resolve({}));
  // Consumo atómico: por defecto el "claim" del desafío gana (count 1).
  const chalUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
  const chalCreate = vi.fn(() => Promise.resolve({ id: 'ch-1' }));
  const chalFindFirst = vi.fn();

  const prisma = {
    $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
    user: { findUnique: userFindUnique },
    webAuthnCredential: {
      findMany: credFindMany,
      findUnique: credFindUnique,
      findFirst: credFindFirst,
      count: credCount,
      create: credCreate,
      delete: credDelete,
      update: credUpdate,
    },
    webAuthnChallenge: {
      updateMany: chalUpdateMany,
      create: chalCreate,
      findFirst: chalFindFirst,
    },
  } as unknown as PrismaService;

  return {
    service: new WebAuthnService(prisma),
    userFindUnique,
    credFindMany,
    credFindUnique,
    credFindFirst,
    credCount,
    credCreate,
    credDelete,
    credUpdate,
    chalUpdateMany,
    chalCreate,
    chalFindFirst,
  };
}

const genOpts = vi.mocked(generateRegistrationOptions);
const verifyReg = vi.mocked(verifyRegistrationResponse);
const genAuth = vi.mocked(generateAuthenticationOptions);
const verifyAuth = vi.mocked(verifyAuthenticationResponse);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WebAuthnService.generateRegistrationOptions', () => {
  it('rechaza un origin fuera de la lista blanca (no genera ni guarda desafío)', async () => {
    const m = build();
    await expect(
      m.service.generateRegistrationOptions('u1', 'https://evil.example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(genOpts).not.toHaveBeenCalled();
    expect(m.chalCreate).not.toHaveBeenCalled();
  });

  it('genera opciones, guarda el desafío single-use y lo devuelve', async () => {
    const m = build();
    genOpts.mockResolvedValue({ challenge: 'CHAL', rp: { id: 'gmt-link.gmtingenieria.com' } } as never);

    const opts = await m.service.generateRegistrationOptions('u1', ORIGIN);

    expect(genOpts).toHaveBeenCalledTimes(1);
    // Invalida desafíos previos + crea el nuevo con purpose REGISTER.
    expect(m.chalUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', purpose: 'REGISTER', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(m.chalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', challenge: 'CHAL', purpose: 'REGISTER' }),
    });
    expect(opts.challenge).toBe('CHAL');
  });
});

describe('WebAuthnService.verifyRegistration', () => {
  function activeChallenge() {
    return {
      id: 'ch-1',
      challenge: 'CHAL',
      expiresAt: new Date(Date.now() + 60_000),
    };
  }

  it('camino feliz: consume el desafío, verifica y guarda la llave', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue(activeChallenge());
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'CREDID',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal', 'hybrid'],
        },
      },
    } as never);

    const dev = await m.service.verifyRegistration('u1', ORIGIN, {} as never, 'Celular de Felipe');

    // El desafío se consumió de forma atómica (where reincluye consumedAt: null).
    expect(m.chalUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ch-1', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    const created = m.credCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(created.data.credentialId).toBe('CREDID');
    expect(created.data.transports).toBe('internal,hybrid');
    expect(created.data.deviceName).toBe('Celular de Felipe');
    expect(Buffer.isBuffer(created.data.publicKey)).toBe(true);
    expect(dev.id).toBe('dev-1');
  });

  it('lanza BadRequest si no hay desafío activo', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue(null);
    await expect(
      m.service.verifyRegistration('u1', ORIGIN, {} as never, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verifyReg).not.toHaveBeenCalled();
  });

  it('lanza BadRequest y no verifica si el desafío expiró (pero lo consume)', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue({
      id: 'ch-1',
      challenge: 'CHAL',
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      m.service.verifyRegistration('u1', ORIGIN, {} as never, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.chalUpdateMany).toHaveBeenCalled(); // se consumió igual (single-use)
    expect(verifyReg).not.toHaveBeenCalled();
  });

  it('rechaza (replay) si otra petición concurrente ya consumió el desafío (claim count 0)', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue(activeChallenge());
    // El "claim" atómico no afecta filas: otro request ganó la carrera.
    m.chalUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      m.service.verifyRegistration('u1', ORIGIN, {} as never, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verifyReg).not.toHaveBeenCalled();
  });

  it('lanza Conflict si el usuario ya alcanzó el tope de dispositivos (20)', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue(activeChallenge());
    m.credCount.mockResolvedValue(20);
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'CREDID', publicKey: new Uint8Array([1]), counter: 0 },
      },
    } as never);
    await expect(
      m.service.verifyRegistration('u1', ORIGIN, {} as never, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(m.credCreate).not.toHaveBeenCalled();
  });

  it('lanza BadRequest si la verificación no es exitosa', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue(activeChallenge());
    verifyReg.mockResolvedValue({ verified: false } as never);
    await expect(
      m.service.verifyRegistration('u1', ORIGIN, {} as never, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.credCreate).not.toHaveBeenCalled();
  });

  it('lanza Conflict si el dispositivo ya estaba registrado (credentialId único)', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue(activeChallenge());
    m.credFindUnique.mockResolvedValue({ id: 'existing' });
    verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'CREDID', publicKey: new Uint8Array([1]), counter: 0 },
      },
    } as never);
    await expect(
      m.service.verifyRegistration('u1', ORIGIN, {} as never, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(m.credCreate).not.toHaveBeenCalled();
  });
});

describe('WebAuthnService credenciales', () => {
  it('deleteCredential rechaza (404) un dispositivo que no es del usuario', async () => {
    const m = build();
    m.credFindFirst.mockResolvedValue(null);
    await expect(m.service.deleteCredential('u1', 'dev-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(m.credDelete).not.toHaveBeenCalled();
  });

  it('deleteCredential borra un dispositivo propio', async () => {
    const m = build();
    m.credFindFirst.mockResolvedValue({ id: 'dev-1' });
    await m.service.deleteCredential('u1', 'dev-1');
    expect(m.credDelete).toHaveBeenCalledWith({ where: { id: 'dev-1' } });
  });

  it('listCredentials mapea a la vista sin exponer la llave', async () => {
    const m = build();
    m.credFindMany.mockResolvedValue([
      { id: 'dev-1', deviceName: 'Notebook', createdAt: new Date('2026-07-15T00:00:00.000Z'), lastUsedAt: null },
    ]);
    const list = await m.service.listCredentials('u1');
    expect(list).toEqual([
      { id: 'dev-1', deviceName: 'Notebook', createdAt: '2026-07-15T00:00:00.000Z', lastUsedAt: null },
    ]);
  });
});

describe('WebAuthnService firma (#68 Fase 2)', () => {
  it('generateSignOptions lanza si el usuario no tiene dispositivos', async () => {
    const m = build();
    m.credFindMany.mockResolvedValue([]);
    await expect(
      m.service.generateSignOptions('u1', ORIGIN, 'CHECKLIST_SUBMISSION', 'HASH'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(genAuth).not.toHaveBeenCalled();
  });

  it('generateSignOptions usa el contentHash como challenge y guarda la sesión', async () => {
    const m = build();
    m.credFindMany.mockResolvedValue([{ credentialId: 'CREDID', transports: 'internal' }]);
    genAuth.mockResolvedValue({ challenge: 'HASH' } as never);
    await m.service.generateSignOptions('u1', ORIGIN, 'CHECKLIST_SUBMISSION', 'HASH');
    expect(genAuth).toHaveBeenCalledWith(expect.objectContaining({ challenge: 'HASH' }));
    // Sesión de firma guardada con el contextHash.
    expect(m.chalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: 'SIGN',
        contextType: 'CHECKLIST_SUBMISSION',
        contextHash: 'HASH',
      }),
    });
  });

  it('consumeSignSession rechaza si otra petición ya la consumió (replay)', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue({ id: 'ch-1', challenge: 'HASH', expiresAt: new Date(Date.now() + 60_000) });
    m.chalUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      m.service.consumeSignSession('u1', 'CHECKLIST_SUBMISSION', 'HASH'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifySignAssertion: verifica, actualiza el contador y devuelve el material', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue({ id: 'ch-1', challenge: 'HASH', expiresAt: new Date(Date.now() + 60_000) });
    m.credFindFirst.mockResolvedValue({
      id: 'dev-1',
      credentialId: 'CREDID',
      deviceName: 'Celular',
      publicKey: new Uint8Array([1, 2]),
      counter: 3,
      transports: 'internal',
    });
    verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 4 } } as never);

    const proof = await m.service.verifySignAssertion(
      'u1',
      ORIGIN,
      'CHECKLIST_SUBMISSION',
      'HASH',
      { id: 'CREDID', response: { signature: 'AA', authenticatorData: 'BB', clientDataJSON: 'CC' } } as never,
    );

    // Se actualizó el contador anti-clonación.
    expect(m.credUpdate).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
      data: expect.objectContaining({ counter: 4, lastUsedAt: expect.any(Date) }),
    });
    expect(proof.credentialId).toBe('CREDID');
    expect(proof.signature).toBeInstanceOf(Uint8Array);
  });

  it('verifySignAssertion: rechaza si la llave no es del usuario', async () => {
    const m = build();
    m.chalFindFirst.mockResolvedValue({ id: 'ch-1', challenge: 'HASH', expiresAt: new Date(Date.now() + 60_000) });
    m.credFindFirst.mockResolvedValue(null);
    await expect(
      m.service.verifySignAssertion('u1', ORIGIN, 'CHECKLIST_SUBMISSION', 'HASH', { id: 'X' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verifyAuth).not.toHaveBeenCalled();
  });
});
