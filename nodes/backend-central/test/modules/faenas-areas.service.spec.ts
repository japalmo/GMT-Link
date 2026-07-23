import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FaenasService } from '../../src/modules/faenas/faenas.service';
import type { CreateAreaDto, UpdateAreaDto } from '../../src/modules/faenas/dto/faenas.dto';

interface AreaMock {
  client: { findUnique: ReturnType<typeof vi.fn> };
  faena: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  area: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  element: { count: ReturnType<typeof vi.fn> };
  task: { count: ReturnType<typeof vi.fn> };
  project: { count: ReturnType<typeof vi.fn> };
}

function build(): { service: FaenasService; mock: AreaMock } {
  const mock: AreaMock = {
    client: { findUnique: vi.fn() },
    faena: {
      findMany: vi.fn(() => Promise.resolve([])),
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(),
      delete: vi.fn(),
    },
    area: {
      findMany: vi.fn(() => Promise.resolve([])),
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'a1', ...args.data }),
      ),
      update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ id: args.where.id, ...args.data }),
      ),
      delete: vi.fn(() => Promise.resolve({ id: 'a1' })),
    },
    element: { count: vi.fn(() => Promise.resolve(0)) },
    task: { count: vi.fn(() => Promise.resolve(0)) },
    project: { count: vi.fn(() => Promise.resolve(0)) },
  };
  return { service: new FaenasService(mock as unknown as PrismaService), mock };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('FaenasService.listAreas', () => {
  let service: FaenasService;
  let mock: AreaMock;

  beforeEach(() => {
    ({ service, mock } = build());
  });

  it('404 si la faena no existe', async () => {
    mock.faena.findUnique.mockResolvedValue(null);
    await expect(service.listAreas('fa1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista las áreas de la faena ordenadas por nombre', async () => {
    mock.faena.findUnique.mockResolvedValue({ id: 'fa1' });
    mock.area.findMany.mockResolvedValue([
      { id: 'a1', name: 'Área Norte' },
      { id: 'a2', name: 'Área Sur' },
    ]);

    const result = await service.listAreas('fa1');

    expect(result).toHaveLength(2);
    expect(mock.area.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { faenaId: 'fa1' },
        orderBy: { name: 'asc' },
      }),
    );
  });
});

describe('FaenasService.createArea', () => {
  let service: FaenasService;
  let mock: AreaMock;

  const dto = (over: Partial<CreateAreaDto> = {}): CreateAreaDto =>
    ({ name: 'Área Norte', ...over }) as CreateAreaDto;

  beforeEach(() => {
    ({ service, mock } = build());
  });

  it('404 si la faena no existe', async () => {
    mock.faena.findUnique.mockResolvedValue(null);
    await expect(service.createArea('fa1', dto())).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.area.create).not.toHaveBeenCalled();
  });

  it('crea el área con nombre y código opcional', async () => {
    mock.faena.findUnique.mockResolvedValue({ id: 'fa1' });

    await service.createArea('fa1', dto({ code: 'AN' }));

    expect(mock.area.create).toHaveBeenCalledWith({
      data: { faenaId: 'fa1', name: 'Área Norte', code: 'AN' },
    });
  });

  it('código ausente → null en la persistencia', async () => {
    mock.faena.findUnique.mockResolvedValue({ id: 'fa1' });

    await service.createArea('fa1', dto());

    const args = mock.area.create.mock.calls[0]?.[0] as { data: { code: unknown } };
    expect(args.data.code).toBeNull();
  });

  it('409 si ya existe un área con ese nombre en la faena (P2002)', async () => {
    mock.faena.findUnique.mockResolvedValue({ id: 'fa1' });
    mock.area.create.mockRejectedValue(p2002());

    await expect(service.createArea('fa1', dto())).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FaenasService.updateArea', () => {
  let service: FaenasService;
  let mock: AreaMock;

  beforeEach(() => {
    ({ service, mock } = build());
  });

  it('404 si el área no existe', async () => {
    mock.area.findUnique.mockResolvedValue(null);
    await expect(
      service.updateArea('a1', { name: 'Nuevo' } as UpdateAreaDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.area.update).not.toHaveBeenCalled();
  });

  it('actualiza nombre y código', async () => {
    mock.area.findUnique.mockResolvedValue({ id: 'a1', faenaId: 'fa1' });

    await service.updateArea('a1', { name: 'Área Poniente', code: 'AP' } as UpdateAreaDto);

    expect(mock.area.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { name: 'Área Poniente', code: 'AP' },
    });
  });

  it('409 si el nuevo nombre choca con otra área de la faena (P2002)', async () => {
    mock.area.findUnique.mockResolvedValue({ id: 'a1', faenaId: 'fa1' });
    mock.area.update.mockRejectedValue(p2002());

    await expect(
      service.updateArea('a1', { name: 'Duplicada' } as UpdateAreaDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FaenasService.removeArea', () => {
  let service: FaenasService;
  let mock: AreaMock;

  beforeEach(() => {
    ({ service, mock } = build());
  });

  it('404 si el área no existe', async () => {
    mock.area.findUnique.mockResolvedValue(null);
    await expect(service.removeArea('a1')).rejects.toBeInstanceOf(NotFoundException);
    expect(mock.area.delete).not.toHaveBeenCalled();
  });

  it('409 AREA_HAS_LINKS si el área tiene elementos (no elimina)', async () => {
    mock.area.findUnique.mockResolvedValue({ id: 'a1', name: 'Área Norte' });
    mock.element.count.mockResolvedValue(2);
    mock.task.count.mockResolvedValue(0);

    await expect(service.removeArea('a1')).rejects.toMatchObject({
      response: { code: 'AREA_HAS_LINKS' },
    });
    await expect(service.removeArea('a1')).rejects.toBeInstanceOf(ConflictException);
    expect(mock.area.delete).not.toHaveBeenCalled();
  });

  it('409 AREA_HAS_LINKS si el área tiene tareas (no elimina)', async () => {
    mock.area.findUnique.mockResolvedValue({ id: 'a1', name: 'Área Norte' });
    mock.element.count.mockResolvedValue(0);
    mock.task.count.mockResolvedValue(1);

    await expect(service.removeArea('a1')).rejects.toMatchObject({
      response: { code: 'AREA_HAS_LINKS' },
    });
    expect(mock.area.delete).not.toHaveBeenCalled();
  });

  it('elimina el área cuando no tiene elementos ni tareas', async () => {
    mock.area.findUnique.mockResolvedValue({ id: 'a1', name: 'Área Norte' });
    mock.element.count.mockResolvedValue(0);
    mock.task.count.mockResolvedValue(0);

    await service.removeArea('a1');

    expect(mock.area.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('P2003 en el delete → 409 AREA_HAS_LINKS (carrera con vínculo nuevo)', async () => {
    mock.area.findUnique.mockResolvedValue({ id: 'a1', name: 'Área Norte' });
    mock.element.count.mockResolvedValue(0);
    mock.task.count.mockResolvedValue(0);
    mock.area.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(service.removeArea('a1')).rejects.toMatchObject({
      response: { code: 'AREA_HAS_LINKS' },
    });
    await expect(service.removeArea('a1')).rejects.toBeInstanceOf(ConflictException);
  });
});
