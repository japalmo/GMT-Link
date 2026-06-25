import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectDocumentStatus, ScopeType } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import { ProjectDocumentsService } from '../../src/modules/project-documents/project-documents.service';
import type { CreateProjectDocumentDto } from '../../src/modules/project-documents/dto/project-documents.dto';

// Archivo no-PDF para saltar el estampado pdf-lib y enfocar la lógica del servicio.
const file = () => ({
  buffer: Buffer.from('contenido'),
  originalname: 'doc.bin',
  mimetype: 'application/octet-stream',
});

interface PrismaMock {
  project: { findUnique: ReturnType<typeof vi.fn> };
  service: { findUnique: ReturnType<typeof vi.fn> };
  projectDocument: {
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  membership: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

function buildPrisma(): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    project: { findUnique: vi.fn() },
    service: { findUnique: vi.fn() },
    projectDocument: {
      count: vi.fn(() => Promise.resolve(0)),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn((args) => Promise.resolve({ id: 'doc1', ...args.data })),
      findMany: vi.fn(() => Promise.resolve([])),
      delete: vi.fn(() => Promise.resolve({ id: 'doc1' })),
    },
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(mock)),
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

const createDto = (over: Partial<CreateProjectDocumentDto> = {}): CreateProjectDocumentDto =>
  ({
    projectId: 'p1',
    serviceId: 's1',
    documentType: 'inf',
    areaCode: 'top',
    name: 'Informe',
    ...over,
  }) as CreateProjectDocumentDto;

describe('ProjectDocumentsService', () => {
  let mock: PrismaMock;
  let prisma: PrismaService;
  let fga: {
    check: ReturnType<typeof vi.fn>;
    writeTuples: ReturnType<typeof vi.fn>;
    deleteTuples: ReturnType<typeof vi.fn>;
  };
  let storage: { save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let service: ProjectDocumentsService;

  beforeEach(() => {
    const bits = buildPrisma();
    mock = bits.mock;
    prisma = bits.prisma;
    fga = {
      check: vi.fn(() => Promise.resolve(true)),
      writeTuples: vi.fn(() => Promise.resolve()),
      deleteTuples: vi.fn(() => Promise.resolve()),
    };
    storage = {
      save: vi.fn(() => Promise.resolve({ url: 'http://x/files/projects/p1/documents/doc.bin' })),
      delete: vi.fn(() => Promise.resolve()),
    };
    service = new ProjectDocumentsService(
      prisma,
      fga as unknown as FgaService,
      storage as unknown as StorageService,
    );
  });

  describe('create', () => {
    it('rechaza si el usuario no tiene acceso al proyecto', async () => {
      fga.check.mockResolvedValue(false);
      await expect(service.create('u1', createDto(), file())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('genera código correlativo, sube y crea en PENDIENTE_QA version 0', async () => {
      fga.check.mockResolvedValue(true);
      mock.project.findUnique.mockResolvedValue({
        code: 'prj',
        client: { code: 'cli', name: 'Cliente' },
        department: { code: 'dep' },
      });
      mock.service.findUnique.mockResolvedValue({ code: 'srv' });
      mock.projectDocument.count.mockResolvedValue(0);
      mock.projectDocument.findUnique.mockResolvedValue(null);
      mock.projectDocument.create.mockImplementation((args) =>
        Promise.resolve({ id: 'doc1', ...args.data }),
      );

      const result = await service.create('u1', createDto(), file());

      expect(result.code).toBe('GMT-CLI-DEP-PRJ-SRV-INF-TOP-001');
      expect(result.status).toBe(ProjectDocumentStatus.PENDIENTE_QA);
      expect(result.version).toBe(0);
      expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
      expect(fga.writeTuples).toHaveBeenCalledWith([
        { user: 'user:u1', relation: 'owner', object: 'document:doc1' },
        { user: 'service:s1', relation: 'service', object: 'document:doc1' },
      ]);
    });

    it('salta el correlativo si ya existe ese código (borrados intermedios)', async () => {
      fga.check.mockResolvedValue(true);
      mock.project.findUnique.mockResolvedValue({
        code: 'prj',
        client: { code: 'cli', name: 'Cliente' },
        department: { code: 'dep' },
      });
      mock.service.findUnique.mockResolvedValue({ code: 'srv' });
      mock.projectDocument.count.mockResolvedValue(0); // sugiere serial 001
      // 001 ya existe, 002 libre
      mock.projectDocument.findUnique
        .mockResolvedValueOnce({ id: 'colision' })
        .mockResolvedValueOnce(null);
      mock.projectDocument.create.mockImplementation((args) =>
        Promise.resolve({ id: 'doc1', ...args.data }),
      );

      const result = await service.create('u1', createDto(), file());
      expect(result.code).toBe('GMT-CLI-DEP-PRJ-SRV-INF-TOP-002');
    });

    it('rechaza si el proyecto o servicio no es válido al generar el código', async () => {
      fga.check.mockResolvedValue(true);
      mock.project.findUnique.mockResolvedValue(null);
      mock.service.findUnique.mockResolvedValue({ code: 'srv' });
      await expect(service.create('u1', createDto(), file())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('uploadRevision', () => {
    it('404 si el documento no existe', async () => {
      mock.projectDocument.findUnique.mockResolvedValue(null);
      await expect(service.uploadRevision('d1', 'u1', file())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rechaza si no tiene permiso de subir revisión', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({ id: 'd1', version: 0, projectId: 'p1' });
      fga.check.mockResolvedValue(false);
      await expect(service.uploadRevision('d1', 'u1', file())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('vuelve a PENDIENTE_QA y resetea firmantes; conserva version si no estaba APROBADO', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        version: 0,
        status: ProjectDocumentStatus.PENDIENTE_QA,
        projectId: 'p1',
        fileUrl: 'http://x/files/old.bin',
      });
      fga.check.mockResolvedValue(true);

      await service.uploadRevision('d1', 'u1', file());

      expect(mock.projectDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd1' },
          data: expect.objectContaining({
            status: ProjectDocumentStatus.PENDIENTE_QA,
            version: 0,
            previousFileUrl: 'http://x/files/old.bin',
            qaSignerId: null,
            clientSignerId: null,
            rejectionReason: null,
          }),
        }),
      );
    });

    it('incrementa version si el documento estaba APROBADO', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        version: 1,
        status: ProjectDocumentStatus.APROBADO,
        projectId: 'p1',
        fileUrl: 'http://x/files/old.bin',
      });
      fga.check.mockResolvedValue(true);

      await service.uploadRevision('d1', 'u1', file());

      expect(mock.projectDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
      );
    });
  });

  describe('signQA', () => {
    it('404 si no existe', async () => {
      mock.projectDocument.findUnique.mockResolvedValue(null);
      await expect(service.signQA('d1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza sin permiso de QA', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({ id: 'd1', version: 0, service: { docCodingConfig: {} } });
      fga.check.mockResolvedValue(false);
      await expect(service.signQA('d1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('pasa a PENDIENTE_CLIENTE si el servicio requiere firma de cliente', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        version: 0,
        service: { docCodingConfig: { requiresClientSignature: true } },
      });
      fga.check.mockResolvedValue(true);

      await service.signQA('d1', 'u1');

      expect(mock.projectDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ProjectDocumentStatus.PENDIENTE_CLIENTE,
            version: 1,
            qaSignerId: 'u1',
          }),
        }),
      );
    });

    it('pasa a APROBADO si no requiere firma de cliente', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        version: 0,
        service: { docCodingConfig: {} },
      });
      fga.check.mockResolvedValue(true);

      await service.signQA('d1', 'u1');

      expect(mock.projectDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ProjectDocumentStatus.APROBADO, version: 1 }),
        }),
      );
    });
  });

  describe('signClient', () => {
    it('404 si no existe', async () => {
      mock.projectDocument.findUnique.mockResolvedValue(null);
      await expect(service.signClient('d1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza si no está pendiente de firma de cliente', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        status: ProjectDocumentStatus.PENDIENTE_QA,
      });
      await expect(service.signClient('d1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza sin permiso de cliente', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        status: ProjectDocumentStatus.PENDIENTE_CLIENTE,
      });
      fga.check.mockResolvedValue(false);
      await expect(service.signClient('d1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aprueba el documento', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        status: ProjectDocumentStatus.PENDIENTE_CLIENTE,
      });
      fga.check.mockResolvedValue(true);

      await service.signClient('d1', 'u1');

      expect(mock.projectDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ProjectDocumentStatus.APROBADO,
            clientSignerId: 'u1',
          }),
        }),
      );
    });
  });

  describe('reject', () => {
    it('404 si no existe', async () => {
      mock.projectDocument.findUnique.mockResolvedValue(null);
      await expect(service.reject('d1', 'u1', 'motivo')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('en PENDIENTE_QA exige permiso QA y registra el motivo', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        status: ProjectDocumentStatus.PENDIENTE_QA,
      });
      fga.check.mockResolvedValue(true);

      await service.reject('d1', 'u1', 'ilegible');

      expect(fga.check).toHaveBeenCalledWith(
        expect.objectContaining({ relation: 'can_sign_qa' }),
      );
      expect(mock.projectDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ProjectDocumentStatus.RECHAZADO, rejectionReason: 'ilegible' },
        }),
      );
    });

    it('rechaza si el documento no está en un estado pendiente (sin acceso)', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        status: ProjectDocumentStatus.APROBADO,
      });
      await expect(service.reject('d1', 'u1', 'x')).rejects.toBeInstanceOf(BadRequestException);
      expect(fga.check).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('org_admin no filtra por proyectos', async () => {
      mock.membership.findFirst.mockResolvedValue({ id: 'adm' });
      await service.list('admin');
      expect(mock.membership.findMany).not.toHaveBeenCalled();
      expect(mock.projectDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('no-admin: rechaza si pide un proyecto fuera de su alcance', async () => {
      mock.membership.findFirst.mockResolvedValue(null);
      mock.membership.findMany.mockResolvedValue([
        { scopeType: ScopeType.PROJECT, scopeId: 'p1' },
      ]);
      mock.project.findUnique.mockResolvedValue(undefined);
      // listAll de proyectos accesibles
      (mock as unknown as { project: { findMany?: ReturnType<typeof vi.fn> } }).project.findMany =
        vi.fn(() => Promise.resolve([{ id: 'p1' }]));

      await expect(service.list('u1', 'p9')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('404 si no existe', async () => {
      mock.projectDocument.findUnique.mockResolvedValue(null);
      await expect(service.remove('d1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza si no es owner ni admin', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({ id: 'd1', ownerId: 'otro', fileUrl: '' });
      mock.membership.findFirst.mockResolvedValue(null);
      await expect(service.remove('d1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('el owner borra: storage + tuplas FGA + registro', async () => {
      mock.projectDocument.findUnique.mockResolvedValue({
        id: 'd1',
        ownerId: 'u1',
        serviceId: 's1',
        fileUrl: 'http://x/files/projects/p1/documents/doc.bin',
      });
      mock.membership.findFirst.mockResolvedValue(null);

      await service.remove('d1', 'u1');

      expect(storage.delete).toHaveBeenCalledWith('projects/p1/documents/doc.bin');
      expect(fga.deleteTuples).toHaveBeenCalledWith([
        { user: 'user:u1', relation: 'owner', object: 'document:d1' },
        { user: 'service:s1', relation: 'service', object: 'document:d1' },
      ]);
      expect(mock.projectDocument.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    });
  });
});
