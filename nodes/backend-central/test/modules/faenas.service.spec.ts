import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  FaenasService,
  indexToLetters,
  lettersToIndex,
} from '../../src/modules/faenas/faenas.service';
import type { CreateFaenaDto } from '../../src/modules/faenas/dto/faenas.dto';

interface FaenaMock {
  client: { findUnique: ReturnType<typeof vi.fn> };
  faena: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function build(): { service: FaenasService; mock: FaenaMock } {
  const mock: FaenaMock = {
    client: { findUnique: vi.fn() },
    faena: {
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'fa1', ...args.data }),
      ),
    },
  };
  return { service: new FaenasService(mock as unknown as PrismaService), mock };
}

const dto = (over: Partial<CreateFaenaDto> = {}): CreateFaenaDto =>
  ({ name: 'Faena Norte', ...over }) as CreateFaenaDto;

/** Extrae el `code` con el que se llamó a faena.create. */
function createdCode(mock: FaenaMock): string {
  const args = mock.faena.create.mock.calls[0]?.[0] as { data: { code: string } };
  return args.data.code;
}

describe('FaenasService.create — autocódigo por cliente', () => {
  let service: FaenasService;
  let mock: FaenaMock;

  beforeEach(() => {
    const bits = build();
    service = bits.service;
    mock = bits.mock;
  });

  it('404 si el cliente no existe', async () => {
    mock.client.findUnique.mockResolvedValue(null);
    await expect(service.create('c1', dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.faena.create).not.toHaveBeenCalled();
  });

  it('cliente sin faenas → primer código `${client.code}-A`', async () => {
    mock.client.findUnique.mockResolvedValue({ id: 'c1', code: 'CLI' });
    mock.faena.findMany.mockResolvedValue([]);

    await service.create('c1', dto());

    expect(createdCode(mock)).toBe('CLI-A');
  });

  it('cliente con faena A existente → siguiente letra B', async () => {
    mock.client.findUnique.mockResolvedValue({ id: 'c1', code: 'CLI' });
    mock.faena.findMany.mockResolvedValue([{ code: 'CLI-A' }]);

    await service.create('c1', dto());

    expect(createdCode(mock)).toBe('CLI-B');
  });

  it('salto de Z a AA cuando ya existe la faena Z', async () => {
    mock.client.findUnique.mockResolvedValue({ id: 'c1', code: 'CLI' });
    mock.faena.findMany.mockResolvedValue([{ code: 'CLI-Y' }, { code: 'CLI-Z' }]);

    await service.create('c1', dto());

    expect(createdCode(mock)).toBe('CLI-AA');
  });

  it('ignora códigos de otro prefijo o con sufijo no alfabético al calcular el máximo', async () => {
    mock.client.findUnique.mockResolvedValue({ id: 'c1', code: 'CLI' });
    mock.faena.findMany.mockResolvedValue([
      { code: 'CLI-A' }, // válido → índice 1
      { code: 'CLI-3' }, // sufijo no alfabético → se ignora
      { code: 'OTRO-Z' }, // prefijo distinto → se ignora
      { code: 'CLIX' }, // sin `-` del prefijo → se ignora
    ]);

    await service.create('c1', dto());

    expect(createdCode(mock)).toBe('CLI-B');
  });

  it('persiste latitude/longitude/address y NO fija supervisor/estado/fechas en la creación', async () => {
    mock.client.findUnique.mockResolvedValue({ id: 'c1', code: 'CLI' });
    mock.faena.findMany.mockResolvedValue([]);

    await service.create('c1', dto({ latitude: -33.45, longitude: -70.66, address: 'Ruta 5' }));

    const args = mock.faena.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({
      clientId: 'c1',
      code: 'CLI-A',
      name: 'Faena Norte',
      latitude: -33.45,
      longitude: -70.66,
      address: 'Ruta 5',
    });
    expect(args.data).not.toHaveProperty('supervisorId');
    expect(args.data).not.toHaveProperty('status');
    expect(args.data).not.toHaveProperty('startDate');
    expect(args.data).not.toHaveProperty('endDate');
  });

  it('coordenadas ausentes → null (no undefined) en la persistencia', async () => {
    mock.client.findUnique.mockResolvedValue({ id: 'c1', code: 'CLI' });
    mock.faena.findMany.mockResolvedValue([]);

    await service.create('c1', dto());

    const args = mock.faena.create.mock.calls[0]?.[0] as {
      data: { latitude: unknown; longitude: unknown; address: unknown };
    };
    expect(args.data.latitude).toBeNull();
    expect(args.data.longitude).toBeNull();
    expect(args.data.address).toBeNull();
  });
});

describe('FaenasService — helpers de código bijective base-26', () => {
  it('lettersToIndex: A→1, Z→26, AA→27, AB→28', () => {
    expect(lettersToIndex('A')).toBe(1);
    expect(lettersToIndex('Z')).toBe(26);
    expect(lettersToIndex('AA')).toBe(27);
    expect(lettersToIndex('AB')).toBe(28);
  });

  it('lettersToIndex: sufijo inválido o vacío → 0', () => {
    expect(lettersToIndex('')).toBe(0);
    expect(lettersToIndex('3')).toBe(0);
    expect(lettersToIndex('A1')).toBe(0);
  });

  it('indexToLetters: 1→A, 26→Z, 27→AA, 28→AB', () => {
    expect(indexToLetters(1)).toBe('A');
    expect(indexToLetters(26)).toBe('Z');
    expect(indexToLetters(27)).toBe('AA');
    expect(indexToLetters(28)).toBe('AB');
  });

  it('round-trip letters ↔ index para 1..100', () => {
    for (let i = 1; i <= 100; i += 1) {
      expect(lettersToIndex(indexToLetters(i))).toBe(i);
    }
  });
});
