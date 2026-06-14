import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type {
  StorageSaveInput,
  StorageSaveResult,
  StorageService,
} from '../../src/common/storage/storage.service';
import { CvService } from '../../src/modules/cv/cv.service';
import type {
  CreateExperienceDto,
  UpdateExperienceDto,
} from '../../src/modules/cv/dto/cv.dto';

/** Fila CVExperience tal como la devuelve Prisma (fechas como Date). */
interface ExperienceRow {
  id: string;
  cvId: string;
  role: string;
  company: string;
  startDate: Date;
  endDate: Date | null;
  description: string | null;
  createdAt: Date;
}

/** CV con arrays como lo devuelve Prisma en este servicio. */
interface CvRow {
  id: string;
  userId: string;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
  experiences: ExperienceRow[];
  education: never[];
  certifications: never[];
}

function baseCv(overrides: Partial<CvRow> = {}): CvRow {
  return {
    id: 'cv-1',
    userId: 'me-1',
    summary: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    experiences: [],
    education: [],
    certifications: [],
    ...overrides,
  };
}

/** Mocks tipados del PrismaService (solo los modelos usados por CvService). */
interface PrismaMocks {
  cvFindUnique: ReturnType<typeof vi.fn>;
  cvCreate: ReturnType<typeof vi.fn>;
  cvUpdate: ReturnType<typeof vi.fn>;
  expCreate: ReturnType<typeof vi.fn>;
  expUpdate: ReturnType<typeof vi.fn>;
  expDelete: ReturnType<typeof vi.fn>;
  expFindFirst: ReturnType<typeof vi.fn>;
  certUpdate: ReturnType<typeof vi.fn>;
  certFindFirst: ReturnType<typeof vi.fn>;
}

/** Mocks tipados del StorageService. */
interface StorageMocks {
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function build(): {
  service: CvService;
  prisma: PrismaMocks;
  storage: StorageMocks;
} {
  const prisma: PrismaMocks = {
    cvFindUnique: vi.fn(),
    cvCreate: vi.fn(),
    cvUpdate: vi.fn(() => Promise.resolve(baseCv())),
    expCreate: vi.fn(),
    expUpdate: vi.fn(),
    expDelete: vi.fn(() => Promise.resolve(undefined)),
    expFindFirst: vi.fn(),
    certUpdate: vi.fn(),
    certFindFirst: vi.fn(),
  };
  const storage: StorageMocks = {
    save: vi.fn(
      (input: StorageSaveInput): Promise<StorageSaveResult> =>
        Promise.resolve({ key: `${input.folder}/k-${input.filename}`, url: `http://x/files/${input.folder}/k-${input.filename}` }),
    ),
    delete: vi.fn(() => Promise.resolve(undefined)),
  };

  const prismaService = {
    cV: { findUnique: prisma.cvFindUnique, create: prisma.cvCreate, update: prisma.cvUpdate },
    cVExperience: {
      create: prisma.expCreate,
      update: prisma.expUpdate,
      delete: prisma.expDelete,
      findFirst: prisma.expFindFirst,
    },
    cVEducation: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    cVCertification: {
      create: vi.fn(),
      update: prisma.certUpdate,
      delete: vi.fn(),
      findFirst: prisma.certFindFirst,
    },
  } as unknown as PrismaService;

  const storageService = { save: storage.save, delete: storage.delete } as unknown as StorageService;

  return { service: new CvService(prismaService, storageService), prisma, storage };
}

describe('CvService.getMe (lazy CV)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crea un CV vacío si el usuario no tiene uno', async () => {
    const { service, prisma } = build();
    prisma.cvFindUnique.mockResolvedValue(null);
    prisma.cvCreate.mockResolvedValue(baseCv());

    const result = await service.getMe('me-1');

    expect(prisma.cvCreate).toHaveBeenCalledTimes(1);
    const arg = prisma.cvCreate.mock.calls[0]?.[0] as { data: { userId: string } };
    expect(arg.data.userId).toBe('me-1');
    expect(result).toEqual({ id: 'cv-1', summary: null, experiences: [], education: [], certifications: [] });
  });

  it('no crea CV si ya existe', async () => {
    const { service, prisma } = build();
    prisma.cvFindUnique.mockResolvedValue(baseCv({ summary: 'hola' }));

    const result = await service.getMe('me-1');

    expect(prisma.cvCreate).not.toHaveBeenCalled();
    expect(result.summary).toBe('hola');
  });
});

describe('CvService experiencias — solo afectan el CV propio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('addExperience usa el cvId del CV propio (derivado de la sesión), no del body', async () => {
    const { service, prisma } = build();
    prisma.cvFindUnique.mockResolvedValue(baseCv());
    prisma.expCreate.mockResolvedValue({
      id: 'e1',
      cvId: 'cv-1',
      role: 'Dev',
      company: 'GMT',
      startDate: new Date('2020-01-01T00:00:00.000Z'),
      endDate: null,
      description: null,
      createdAt: new Date(),
    } satisfies ExperienceRow);

    const dto: CreateExperienceDto = { role: 'Dev', company: 'GMT', startDate: '2020-01-01T00:00:00.000Z' };
    const view = await service.addExperience('me-1', dto);

    const arg = prisma.expCreate.mock.calls[0]?.[0] as { data: { cvId: string } };
    expect(arg.data.cvId).toBe('cv-1');
    expect(view).toEqual({
      id: 'e1',
      role: 'Dev',
      company: 'GMT',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: null,
      description: null,
    });
  });

  it('updateExperience de una fila AJENA → 404 (no actualiza)', async () => {
    const { service, prisma } = build();
    prisma.cvFindUnique.mockResolvedValue(baseCv());
    prisma.expFindFirst.mockResolvedValue(null); // no pertenece al CV del usuario

    await expect(
      service.updateExperience('me-1', 'otra-fila', { role: 'X' } as UpdateExperienceDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.expUpdate).not.toHaveBeenCalled();

    // El findFirst se scopeó por cvId del usuario (la verificación de propiedad).
    const arg = prisma.expFindFirst.mock.calls[0]?.[0] as { where: { id: string; cvId: string } };
    expect(arg.where).toEqual({ id: 'otra-fila', cvId: 'cv-1' });
  });

  it('deleteExperience de una fila propia sí borra', async () => {
    const { service, prisma } = build();
    prisma.cvFindUnique.mockResolvedValue(baseCv());
    prisma.expFindFirst.mockResolvedValue({ id: 'e1' });

    await service.deleteExperience('me-1', 'e1');

    expect(prisma.expDelete).toHaveBeenCalledWith({ where: { id: 'e1' } });
  });
});

describe('CvService diploma — sube PDF y setea fileUrl en la certificación propia', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifica propiedad, guarda en storage (folder diplomas) y persiste fileUrl', async () => {
    const { service, prisma, storage } = build();
    prisma.cvFindUnique.mockResolvedValue(baseCv());
    prisma.certFindFirst.mockResolvedValue({ id: 'c1' });
    prisma.certUpdate.mockResolvedValue({
      id: 'c1',
      cvId: 'cv-1',
      name: 'Cert',
      issuer: null,
      issuedAt: null,
      expiresAt: null,
      fileUrl: 'http://x/files/diplomas/k-d.pdf',
      createdAt: new Date(),
    });

    const view = await service.setCertificationDiploma('me-1', 'c1', {
      buffer: Buffer.from('pdf'),
      originalname: 'd.pdf',
      mimetype: 'application/pdf',
    });

    expect(storage.save).toHaveBeenCalledTimes(1);
    const saveArg = storage.save.mock.calls[0]?.[0] as StorageSaveInput;
    expect(saveArg.folder).toBe('diplomas');
    const updateArg = prisma.certUpdate.mock.calls[0]?.[0] as { data: { fileUrl: string } };
    expect(updateArg.data.fileUrl).toBe('http://x/files/diplomas/k-d.pdf');
    expect(view.fileUrl).toBe('http://x/files/diplomas/k-d.pdf');
  });

  it('certificación ajena → 404 (no guarda ni actualiza)', async () => {
    const { service, prisma, storage } = build();
    prisma.cvFindUnique.mockResolvedValue(baseCv());
    prisma.certFindFirst.mockResolvedValue(null);

    await expect(
      service.setCertificationDiploma('me-1', 'ajena', {
        buffer: Buffer.from('x'),
        originalname: 'd.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.save).not.toHaveBeenCalled();
    expect(prisma.certUpdate).not.toHaveBeenCalled();
  });
});
