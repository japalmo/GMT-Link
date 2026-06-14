import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import type { PersonalDocument } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import {
  DocumentsService,
  type UploadedDocumentFile,
} from '../../src/modules/documents/documents.service';

/** Construye una fila PersonalDocument completa con overrides. */
function buildRow(overrides: Partial<PersonalDocument> = {}): PersonalDocument {
  const now = new Date('2026-06-14T00:00:00.000Z');
  return {
    id: 'doc-1',
    userId: 'u1',
    type: 'carnet',
    name: 'Carnet de conducir',
    fileUrl: 'http://localhost:3001/files/documents/old.pdf',
    issuedAt: null,
    expiresAt: null,
    status: DocumentStatus.EN_REVISION,
    previousFileUrl: null,
    reviewedById: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface PrismaParts {
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    create: parts.create ?? vi.fn(),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),
    update: parts.update ?? vi.fn(),
    delete: parts.delete ?? vi.fn(() => Promise.resolve(undefined)),
  };
  const prisma = {
    personalDocument: resolved,
  } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

function buildStorage(): { storage: StorageService; save: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> } {
  const save = vi.fn(() =>
    Promise.resolve({ key: 'documents/new.pdf', url: 'http://localhost:3001/files/documents/new.pdf' }),
  );
  const del = vi.fn(() => Promise.resolve(undefined));
  return { storage: { save, delete: del } as unknown as StorageService, save, del };
}

const FILE: UploadedDocumentFile = {
  buffer: Buffer.from('pdf'),
  originalname: 'doc.pdf',
  mimetype: 'application/pdf',
};

describe('DocumentsService', () => {
  let storageBits: ReturnType<typeof buildStorage>;

  beforeEach(() => {
    storageBits = buildStorage();
  });

  it('create sube el archivo y deja el documento EN_REVISION', async () => {
    const create = vi.fn((args: { data: PersonalDocument }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'doc-new' })),
    );
    const { prisma } = buildPrisma({ create });
    const service = new DocumentsService(prisma, storageBits.storage);

    const view = await service.create('u1', { type: 'carnet', name: 'Carnet' }, FILE);

    expect(storageBits.save).toHaveBeenCalledTimes(1);
    expect(storageBits.save.mock.calls[0]?.[0]).toMatchObject({ folder: 'documents' });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0]?.data as { userId: string; status: DocumentStatus; fileUrl: string };
    expect(data.userId).toBe('u1');
    expect(data.status).toBe(DocumentStatus.EN_REVISION);
    expect(data.fileUrl).toBe('http://localhost:3001/files/documents/new.pdf');
    expect(view.status).toBe(DocumentStatus.EN_REVISION);
  });

  it('addVersion conserva el archivo anterior y vuelve a EN_REVISION limpiando el revisor', async () => {
    const current = buildRow({
      fileUrl: 'http://localhost:3001/files/documents/old.pdf',
      status: DocumentStatus.APROBADO,
      reviewedById: 'admin',
      reviewedAt: new Date(),
    });
    const findFirst = vi.fn(() => Promise.resolve(current));
    const update = vi.fn((args: { data: Partial<PersonalDocument> }) =>
      Promise.resolve(buildRow({ ...current, ...args.data })),
    );
    const { prisma } = buildPrisma({ findFirst, update });
    const service = new DocumentsService(prisma, storageBits.storage);

    await service.addVersion('u1', 'doc-1', FILE);

    const data = update.mock.calls[0]?.[0]?.data as {
      previousFileUrl: string;
      fileUrl: string;
      status: DocumentStatus;
      reviewedById: string | null;
      reviewedAt: Date | null;
    };
    expect(data.previousFileUrl).toBe('http://localhost:3001/files/documents/old.pdf');
    expect(data.fileUrl).toBe('http://localhost:3001/files/documents/new.pdf');
    expect(data.status).toBe(DocumentStatus.EN_REVISION);
    expect(data.reviewedById).toBeNull();
    expect(data.reviewedAt).toBeNull();
  });

  it('addVersion sobre un documento ajeno o inexistente lanza 404', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findFirst });
    const service = new DocumentsService(prisma, storageBits.storage);

    await expect(service.addVersion('u1', 'ajeno', FILE)).rejects.toBeInstanceOf(NotFoundException);
    expect(storageBits.save).not.toHaveBeenCalled();
  });

  it('listMine con expiring=true filtra por ventana de vencimiento (gte ahora, lte +30d)', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = new DocumentsService(prisma, storageBits.storage);

    await service.listMine('u1', { expiring: true });

    const where = findMany.mock.calls[0]?.[0]?.where as {
      userId: string;
      expiresAt?: { gte: Date; lte: Date };
    };
    expect(where.userId).toBe('u1');
    expect(where.expiresAt?.gte).toBeInstanceOf(Date);
    expect(where.expiresAt?.lte).toBeInstanceOf(Date);
    expect(where.expiresAt!.lte.getTime()).toBeGreaterThan(where.expiresAt!.gte.getTime());
  });

  it('approve fija APROBADO con el revisor', async () => {
    const update = vi.fn((args: { data: Partial<PersonalDocument> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ update });
    const service = new DocumentsService(prisma, storageBits.storage);

    await service.approve('admin-id', 'doc-1');

    const data = update.mock.calls[0]?.[0]?.data as { status: DocumentStatus; reviewedById: string };
    expect(data.status).toBe(DocumentStatus.APROBADO);
    expect(data.reviewedById).toBe('admin-id');
  });
});
