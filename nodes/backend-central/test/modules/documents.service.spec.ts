import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import type { PersonalDocument } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import { R2StorageService } from '../../src/common/storage/r2-storage.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import {
  DocumentsService,
  type UploadedDocumentFile,
} from '../../src/modules/documents/documents.service';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';

const gamificationMock = { awardPoints: vi.fn(() => Promise.resolve()) } as unknown as GamificationService;

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
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function buildPrisma(parts: Partial<PrismaParts> = {}): { prisma: PrismaService; parts: PrismaParts } {
  const resolved: PrismaParts = {
    create: parts.create ?? vi.fn(),
    findMany: parts.findMany ?? vi.fn(() => Promise.resolve([])),
    findFirst: parts.findFirst ?? vi.fn(() => Promise.resolve(null)),
    findUnique: parts.findUnique ?? vi.fn(() => Promise.resolve(null)),
    update: parts.update ?? vi.fn(),
    delete: parts.delete ?? vi.fn(() => Promise.resolve(undefined)),
  };
  const prisma = {
    personalDocument: resolved,
  } as unknown as PrismaService;
  return { prisma, parts: resolved };
}

type FgaCheckInput = { user: string; relation: string; object: string };

function buildFga(): {
  fga: FgaService;
  check: ReturnType<typeof vi.fn<(input: FgaCheckInput) => Promise<boolean>>>;
} {
  const check = vi.fn<(input: FgaCheckInput) => Promise<boolean>>(() => Promise.resolve(false));
  return { fga: { check } as unknown as FgaService, check };
}

function buildStorage(): { storage: StorageService; save: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> } {
  const save = vi.fn(() =>
    Promise.resolve({ key: 'documents/new.pdf', url: 'http://localhost:3001/files/documents/new.pdf' }),
  );
  const del = vi.fn(() => Promise.resolve(undefined));
  return { storage: { save, delete: del } as unknown as StorageService, save, del };
}

function buildNotifications(): { notifications: NotificationsService; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(() => Promise.resolve(undefined));
  return { notifications: { create } as unknown as NotificationsService, create };
}

const FILE: UploadedDocumentFile = {
  buffer: Buffer.from('pdf'),
  originalname: 'doc.pdf',
  mimetype: 'application/pdf',
};

describe('DocumentsService', () => {
  let storageBits: ReturnType<typeof buildStorage>;
  let notifBits: ReturnType<typeof buildNotifications>;
  let fgaBits: ReturnType<typeof buildFga>;

  beforeEach(() => {
    storageBits = buildStorage();
    notifBits = buildNotifications();
    fgaBits = buildFga();
  });

  it('create sube el archivo y deja el documento EN_REVISION', async () => {
    const create = vi.fn((args: { data: PersonalDocument }) =>
      Promise.resolve(buildRow({ ...args.data, id: 'doc-new' })),
    );
    const { prisma } = buildPrisma({ create });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    const view = await service.create('u1', { type: 'carnet', name: 'Carnet' }, FILE);

    expect(storageBits.save).toHaveBeenCalledTimes(1);
    expect(storageBits.save.mock.calls[0]?.[0]).toMatchObject({ folder: 'documents' });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0]?.data as { userId: string; status: DocumentStatus; fileUrl: string };
    expect(data.userId).toBe('u1');
    expect(data.status).toBe(DocumentStatus.EN_REVISION);
    // Fase 1B: se persiste la CLAVE del storage, no la URL (con R2 sería una
    // prefirma con TTL de 1 h); la URL fresca la entrega GET :id/file-url.
    expect(data.fileUrl).toBe('documents/new.pdf');
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
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await service.addVersion('u1', 'doc-1', FILE);

    const data = update.mock.calls[0]?.[0]?.data as {
      previousFileUrl: string;
      fileUrl: string;
      status: DocumentStatus;
      reviewedById: string | null;
      reviewedAt: Date | null;
    };
    expect(data.previousFileUrl).toBe('http://localhost:3001/files/documents/old.pdf');
    // Fase 1B: la nueva versión también persiste la CLAVE, no la URL.
    expect(data.fileUrl).toBe('documents/new.pdf');
    expect(data.status).toBe(DocumentStatus.EN_REVISION);
    expect(data.reviewedById).toBeNull();
    expect(data.reviewedAt).toBeNull();
  });

  it('addVersion sobre un documento ajeno o inexistente lanza 404', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const { prisma } = buildPrisma({ findFirst });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await expect(service.addVersion('u1', 'ajeno', FILE)).rejects.toBeInstanceOf(NotFoundException);
    expect(storageBits.save).not.toHaveBeenCalled();
  });

  it('listMine con expiring=true filtra por ventana de vencimiento (gte ahora, lte +30d)', async () => {
    const findMany = vi.fn<
      (args: {
        where: { userId: string; expiresAt?: { gte: Date; lte: Date } };
      }) => Promise<PersonalDocument[]>
    >(() => Promise.resolve([]));
    const { prisma } = buildPrisma({ findMany });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await service.listMine('u1', { expiring: true });

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where?.userId).toBe('u1');
    expect(where?.expiresAt?.gte).toBeInstanceOf(Date);
    expect(where?.expiresAt?.lte).toBeInstanceOf(Date);
    expect(where!.expiresAt!.lte.getTime()).toBeGreaterThan(where!.expiresAt!.gte.getTime());
  });

  it('approve fija APROBADO con el revisor', async () => {
    const update = vi.fn((args: { data: Partial<PersonalDocument> }) =>
      Promise.resolve(buildRow({ ...args.data })),
    );
    const { prisma } = buildPrisma({ update });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await service.approve('admin-id', 'doc-1');

    const data = update.mock.calls[0]?.[0]?.data as { status: DocumentStatus; reviewedById: string };
    expect(data.status).toBe(DocumentStatus.APROBADO);
    expect(data.reviewedById).toBe('admin-id');
  });

  it('approve notifica al DUEÑO del documento (document.reviewed, link a Mis documentos)', async () => {
    const update = vi.fn((args: { data: Partial<PersonalDocument> }) =>
      Promise.resolve(buildRow({ ...args.data, userId: 'owner-1', name: 'Carnet' })),
    );
    const { prisma } = buildPrisma({ update });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await service.approve('admin-id', 'doc-1');

    expect(notifBits.create).toHaveBeenCalledTimes(1);
    const [toUserId, payload] = notifBits.create.mock.calls[0] as [
      string,
      { type: string; title: string; link: string },
    ];
    expect(toUserId).toBe('owner-1');
    expect(payload.type).toBe('document.reviewed');
    expect(payload.link).toBe('/perfil/documentos');
    expect(payload.title).toContain('aprobado');
  });

  it('reject notifica al dueño con título de rechazo', async () => {
    const update = vi.fn((args: { data: Partial<PersonalDocument> }) =>
      Promise.resolve(buildRow({ ...args.data, userId: 'owner-1', name: 'Carnet' })),
    );
    const { prisma } = buildPrisma({ update });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await service.reject('admin-id', 'doc-1', 'ilegible');

    expect(notifBits.create).toHaveBeenCalledTimes(1);
    const payload = notifBits.create.mock.calls[0]?.[1] as { title: string; type: string };
    expect(payload.type).toBe('document.reviewed');
    expect(payload.title).toContain('rechazado');
  });

  it('NO notifica si el dueño es quien revisa (defensivo)', async () => {
    const update = vi.fn((args: { data: Partial<PersonalDocument> }) =>
      Promise.resolve(buildRow({ ...args.data, userId: 'same-user' })),
    );
    const { prisma } = buildPrisma({ update });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await service.approve('same-user', 'doc-1');

    expect(notifBits.create).not.toHaveBeenCalled();
  });

  it('approve sobre documento inexistente lanza 404 y no notifica', async () => {
    const notFound = Object.assign(new Error('not found'), { code: 'P2025' });
    const update = vi.fn(() => Promise.reject(notFound));
    const { prisma } = buildPrisma({ update });
    const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

    await expect(service.approve('admin-id', 'no-existe')).rejects.toBeInstanceOf(NotFoundException);
    expect(notifBits.create).not.toHaveBeenCalled();
  });

  describe('getFileUrl (Fase 1B: URL fresca al leer, clave en fileUrl)', () => {
    const baseUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3001';

    function buildService(findUnique: ReturnType<typeof vi.fn>): DocumentsService {
      const { prisma } = buildPrisma({ findUnique });
      return new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);
    }

    it('404 si el documento no existe', async () => {
      const service = buildService(vi.fn(() => Promise.resolve(null)));
      await expect(service.getFileUrl('u1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('dueño con CLAVE y backend local → URL del FilesController', async () => {
      const service = buildService(
        vi.fn(() => Promise.resolve({ userId: 'u1', fileUrl: 'documents/new.pdf', previousFileUrl: null })),
      );

      const result = await service.getFileUrl('u1', 'doc-1');

      expect(result).toEqual({ url: `${baseUrl}/files/documents/new.pdf` });
      // El dueño no requiere consulta a FGA.
      expect(fgaBits.check).not.toHaveBeenCalled();
    });

    it('dueño con URL absoluta legada → passthrough tal cual', async () => {
      const service = buildService(
        vi.fn(() =>
          Promise.resolve({
            userId: 'u1',
            fileUrl: 'https://r2.example.com/firmada-vieja.pdf?sig=x',
            previousFileUrl: null,
          }),
        ),
      );

      const result = await service.getFileUrl('u1', 'doc-1');

      expect(result).toEqual({ url: 'https://r2.example.com/firmada-vieja.pdf?sig=x' });
    });

    it('previous=true entrega la versión anterior fresca; 404 si no hay', async () => {
      const service = buildService(
        vi.fn(() =>
          Promise.resolve({ userId: 'u1', fileUrl: 'documents/new.pdf', previousFileUrl: 'documents/old.pdf' }),
        ),
      );

      const result = await service.getFileUrl('u1', 'doc-1', { previous: true });
      expect(result).toEqual({ url: `${baseUrl}/files/documents/old.pdf` });

      const sinPrevia = buildService(
        vi.fn(() => Promise.resolve({ userId: 'u1', fileUrl: 'documents/new.pdf', previousFileUrl: null })),
      );
      await expect(sinPrevia.getFileUrl('u1', 'doc-1', { previous: true })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('ajeno SIN permisos → 404 (no distingue inexistente de ajeno)', async () => {
      fgaBits.check.mockResolvedValue(false);
      const service = buildService(
        vi.fn(() => Promise.resolve({ userId: 'owner-1', fileUrl: 'documents/new.pdf', previousFileUrl: null })),
      );

      await expect(service.getFileUrl('intruso', 'doc-1')).rejects.toBeInstanceOf(NotFoundException);
      // Se consultaron ambas relaciones sobre la organización.
      const relations = fgaBits.check.mock.calls.map(
        (c) => (c[0] as { relation: string; object: string }).relation,
      );
      expect(relations).toEqual(
        expect.arrayContaining(['can_review_documents', 'can_manage_users']),
      );
      for (const call of fgaBits.check.mock.calls) {
        expect((call[0] as { object: string }).object).toBe('organization:gmt');
      }
    });

    it('ajeno con can_review_documents (revisor) → permitido', async () => {
      fgaBits.check.mockImplementation((input: { relation: string }) =>
        Promise.resolve(input.relation === 'can_review_documents'),
      );
      const service = buildService(
        vi.fn(() => Promise.resolve({ userId: 'owner-1', fileUrl: 'documents/new.pdf', previousFileUrl: null })),
      );

      const result = await service.getFileUrl('revisor', 'doc-1');
      expect(result).toEqual({ url: `${baseUrl}/files/documents/new.pdf` });
    });

    it('ajeno con can_manage_users (gestor) → permitido', async () => {
      fgaBits.check.mockImplementation((input: { relation: string }) =>
        Promise.resolve(input.relation === 'can_manage_users'),
      );
      const service = buildService(
        vi.fn(() => Promise.resolve({ userId: 'owner-1', fileUrl: 'documents/new.pdf', previousFileUrl: null })),
      );

      const result = await service.getFileUrl('gestor', 'doc-1');
      expect(result).toEqual({ url: `${baseUrl}/files/documents/new.pdf` });
    });

    it('CLAVE con R2 activo → URL prefirmada fresca', async () => {
      // Instancia con el prototipo real de R2 (sin correr su constructor) para
      // que el narrowing `instanceof R2StorageService` tome el camino de presign.
      const r2 = Object.create(R2StorageService.prototype) as R2StorageService;
      const presign = vi.fn(() => Promise.resolve('https://r2.example.com/presign-fresca'));
      (r2 as unknown as { createPresignedGetUrl: unknown }).createPresignedGetUrl = presign;
      const { prisma } = buildPrisma({
        findUnique: vi.fn(() =>
          Promise.resolve({ userId: 'u1', fileUrl: 'documents/new.pdf', previousFileUrl: null }),
        ),
      });
      const service = new DocumentsService(prisma, r2, notifBits.notifications, gamificationMock, fgaBits.fga);

      const result = await service.getFileUrl('u1', 'doc-1');

      expect(presign).toHaveBeenCalledWith('documents/new.pdf');
      expect(result).toEqual({ url: 'https://r2.example.com/presign-fresca' });
    });
  });

  describe('remove (borrado del blob con clave o URL legada)', () => {
    it('fileUrl con CLAVE (Fase 1B) borra el objeto directo; la versión anterior legada extrae la clave de /files/', async () => {
      const findFirst = vi.fn(() =>
        Promise.resolve(
          buildRow({
            fileUrl: 'documents/new.pdf',
            previousFileUrl: 'http://localhost:3001/files/documents/old.pdf',
          }),
        ),
      );
      const { prisma } = buildPrisma({ findFirst });
      const service = new DocumentsService(prisma, storageBits.storage, notifBits.notifications, gamificationMock, fgaBits.fga);

      await service.remove('u1', 'doc-1');

      expect(storageBits.del).toHaveBeenCalledWith('documents/new.pdf');
      expect(storageBits.del).toHaveBeenCalledWith('documents/old.pdf');
    });
  });
});
