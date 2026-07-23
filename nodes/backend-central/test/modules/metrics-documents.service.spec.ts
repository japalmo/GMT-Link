import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MetricsService } from '../../src/modules/metrics/metrics.service';
import { OtpService } from '../../src/common/otp.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { EmailService } from '../../src/common/email.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { StorageService } from '../../src/common/storage/storage.service';
import type { CreateDesktopDocumentDto } from '../../src/modules/metrics/dto/metrics.dto';

interface DocMock {
  $transaction: ReturnType<typeof vi.fn>;
  task: { findUnique: ReturnType<typeof vi.fn> };
  element: { findUnique: ReturnType<typeof vi.fn> };
  service: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  projectDocument: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

interface FgaMock {
  check: ReturnType<typeof vi.fn>;
  writeTuples: ReturnType<typeof vi.fn>;
}

interface StorageMock {
  save: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function build(): {
  service: MetricsService;
  prisma: DocMock;
  fga: FgaMock;
  storage: StorageMock;
} {
  const prisma: DocMock = {
    $transaction: vi.fn(),
    task: { findUnique: vi.fn(() => Promise.resolve(null)) },
    element: { findUnique: vi.fn(() => Promise.resolve(null)) },
    service: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    projectDocument: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'doc-1', ...args.data }),
      ),
    },
  };
  prisma.$transaction.mockImplementation((ops: unknown) => {
    if (typeof ops === 'function') {
      return (ops as (tx: DocMock) => unknown)(prisma);
    }
    if (Array.isArray(ops)) {
      return Promise.all(ops);
    }
    return Promise.resolve(ops);
  });

  const fga: FgaMock = {
    check: vi.fn(() => Promise.resolve(true)),
    writeTuples: vi.fn(() => Promise.resolve()),
  };

  const emailService = { send: vi.fn(() => Promise.resolve()) };
  const storage: StorageMock = {
    save: vi.fn(() => Promise.resolve({ key: 'k', url: 'http://localhost:3001/files/k' })),
    read: vi.fn(() => Promise.resolve(Buffer.from(''))),
    exists: vi.fn(() => Promise.resolve(true)),
    delete: vi.fn(() => Promise.resolve()),
  };
  const otp = new OtpService(prisma as unknown as PrismaService);

  const service = new MetricsService(
    prisma as unknown as PrismaService,
    emailService as unknown as EmailService,
    fga as unknown as FgaService,
    storage as unknown as StorageService,
    otp,
  );
  return { service, prisma, fga, storage };
}

const dto = (over: Partial<CreateDesktopDocumentDto> = {}): CreateDesktopDocumentDto =>
  ({
    blob_path: 'metrics/9f3a-PROT-001.pdf',
    file_hash: 'abc123',
    doc_type: 'CR',
    codigo: 'GMT-SQM-SD-P1-TOP-CR-GEN-001',
    ...over,
  }) as CreateDesktopDocumentDto;

const taskRow = { id: 'task-1', projectId: 'proj-1', serviceId: 'serv-1' };

describe('MetricsService.createDesktopDocument', () => {
  let service: MetricsService;
  let prisma: DocMock;
  let fga: FgaMock;
  let storage: StorageMock;

  beforeEach(() => {
    ({ service, prisma, fga, storage } = build());
  });

  it('feliz por task_id: resuelve proyecto y servicio desde la tarea, guarda la CLAVE en fileUrl y crea PENDIENTE_QA por defecto', async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow);

    const result = await service.createDesktopDocument('u1', dto({ task_id: 'task-1' }));

    expect(fga.check).toHaveBeenCalledWith({
      user: 'user:u1',
      relation: 'can_submit_measurements',
      object: 'project:proj-1',
    });
    expect(storage.exists).toHaveBeenCalledWith('metrics/9f3a-PROT-001.pdf');
    expect(prisma.projectDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'GMT-SQM-SD-P1-TOP-CR-GEN-001',
          fileUrl: 'metrics/9f3a-PROT-001.pdf',
          fileHash: 'abc123',
          status: 'PENDIENTE_QA',
          version: 0,
          projectId: 'proj-1',
          serviceId: 'serv-1',
          taskId: 'task-1',
          ownerId: 'u1',
        }),
      }),
    );
    expect(fga.writeTuples).toHaveBeenCalledWith([
      { user: 'user:u1', relation: 'owner', object: 'document:doc-1' },
      { user: 'service:serv-1', relation: 'service', object: 'document:doc-1' },
    ]);
    expect(result).toMatchObject({
      success: true,
      id: 'doc-1',
      code: 'GMT-SQM-SD-P1-TOP-CR-GEN-001',
      status: 'PENDIENTE_QA',
    });
  });

  it('feliz por element_code: resuelve proyecto por elemento, usa el ÚNICO servicio del proyecto y respeta estado BORRADOR', async () => {
    prisma.element.findUnique.mockResolvedValue({ projectId: 'proj-2' });
    prisma.service.findMany.mockResolvedValue([{ id: 'serv-9' }]);

    await service.createDesktopDocument(
      'u1',
      dto({ element_code: 'R1', estado: 'BORRADOR' }),
    );

    expect(prisma.element.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'R1' } }),
    );
    expect(prisma.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'proj-2' } }),
    );
    expect(prisma.projectDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'BORRADOR',
          projectId: 'proj-2',
          serviceId: 'serv-9',
          taskId: null,
        }),
      }),
    );
  });

  it('400 si no viene ni task_id ni element_code', async () => {
    await expect(service.createDesktopDocument('u1', dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.projectDocument.create).not.toHaveBeenCalled();
  });

  it('404 si la tarea no existe', async () => {
    prisma.task.findUnique.mockResolvedValue(null);
    await expect(
      service.createDesktopDocument('u1', dto({ task_id: 'task-x' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.projectDocument.create).not.toHaveBeenCalled();
  });

  describe('validación de blob_path (C1)', () => {
    it('400 si blob_path es una URL absoluta (spoofeable)', async () => {
      await expect(
        service.createDesktopDocument(
          'u1',
          dto({ task_id: 'task-1', blob_path: 'https://evil.com/falso.pdf' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.task.findUnique).not.toHaveBeenCalled();
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });

    it('400 si la clave está fuera del namespace metrics/ del upload del escritorio', async () => {
      for (const blobPath of ['dems/R1/MDE.tif', 'metrics/../secreto.pdf', 'metrics/', 'otra/cosa.pdf']) {
        await expect(
          service.createDesktopDocument('u1', dto({ task_id: 'task-1', blob_path: blobPath })),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });

    it('400 si el objeto no existe en el almacenamiento (no se registra un documento sin PDF)', async () => {
      prisma.task.findUnique.mockResolvedValue(taskRow);
      storage.exists.mockResolvedValue(false);

      await expect(
        service.createDesktopDocument('u1', dto({ task_id: 'task-1' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
      expect(fga.writeTuples).not.toHaveBeenCalled();
    });
  });

  describe('autorización (I2: FGA inmediato tras resolver el proyecto)', () => {
    it('403 si FGA niega can_submit_measurements, sin filtrar información posterior', async () => {
      prisma.task.findUnique.mockResolvedValue({ ...taskRow, serviceId: null });
      fga.check.mockResolvedValue(false);

      await expect(
        service.createDesktopDocument('u1', dto({ task_id: 'task-1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Nada después del deny: ni servicios del proyecto, ni storage, ni unicidad.
      expect(prisma.service.findMany).not.toHaveBeenCalled();
      expect(prisma.service.findUnique).not.toHaveBeenCalled();
      expect(storage.exists).not.toHaveBeenCalled();
      expect(prisma.projectDocument.findUnique).not.toHaveBeenCalled();
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
      expect(fga.writeTuples).not.toHaveBeenCalled();
    });
  });

  describe('cruce task_id + element_code (I4)', () => {
    it('400 si el elemento pertenece a OTRO proyecto que la tarea', async () => {
      prisma.task.findUnique.mockResolvedValue(taskRow); // proj-1
      prisma.element.findUnique.mockResolvedValue({ projectId: 'proj-B' });

      await expect(
        service.createDesktopDocument('u1', dto({ task_id: 'task-1', element_code: 'R1' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });

    it('feliz cuando tarea y elemento comparten proyecto', async () => {
      prisma.task.findUnique.mockResolvedValue(taskRow); // proj-1
      prisma.element.findUnique.mockResolvedValue({ projectId: 'proj-1' });

      const result = await service.createDesktopDocument(
        'u1',
        dto({ task_id: 'task-1', element_code: 'R1' }),
      );

      expect(result.success).toBe(true);
    });
  });

  describe('resolución determinista del servicio (I3)', () => {
    it('(b) sin servicio en la tarea: resuelve service_code contra el proyecto (clave natural)', async () => {
      prisma.task.findUnique.mockResolvedValue({ ...taskRow, serviceId: null });
      prisma.service.findUnique.mockResolvedValue({ id: 'serv-7' });

      await service.createDesktopDocument(
        'u1',
        dto({ task_id: 'task-1', service_code: 'TOP' }),
      );

      expect(prisma.service.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId_code: { projectId: 'proj-1', code: 'TOP' } },
        }),
      );
      expect(prisma.projectDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ serviceId: 'serv-7' }),
        }),
      );
    });

    it('400 si el service_code no existe en el proyecto', async () => {
      prisma.task.findUnique.mockResolvedValue({ ...taskRow, serviceId: null });
      prisma.service.findUnique.mockResolvedValue(null);

      await expect(
        service.createDesktopDocument('u1', dto({ task_id: 'task-1', service_code: 'NADA' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });

    it('(d) 400 si el proyecto tiene varios servicios y no viene service_code (nunca adivinar)', async () => {
      prisma.element.findUnique.mockResolvedValue({ projectId: 'proj-2' });
      prisma.service.findMany.mockResolvedValue([{ id: 'serv-1' }, { id: 'serv-2' }]);

      await expect(
        service.createDesktopDocument('u1', dto({ element_code: 'R1' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });

    it('(d) 400 si el proyecto no tiene servicios', async () => {
      prisma.element.findUnique.mockResolvedValue({ projectId: 'proj-2' });
      prisma.service.findMany.mockResolvedValue([]);

      await expect(
        service.createDesktopDocument('u1', dto({ element_code: 'R1' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });
  });

  describe('unicidad del código', () => {
    it('409 si ya existe un documento con ese código', async () => {
      prisma.task.findUnique.mockResolvedValue(taskRow);
      prisma.projectDocument.findUnique.mockResolvedValue({ id: 'doc-existente' });

      await expect(
        service.createDesktopDocument('u1', dto({ task_id: 'task-1' })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });

    it('409 ante la carrera de duplicados (P2002 en el create)', async () => {
      prisma.task.findUnique.mockResolvedValue(taskRow);
      prisma.projectDocument.findUnique.mockResolvedValue(null);
      prisma.projectDocument.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createDesktopDocument('u1', dto({ task_id: 'task-1' })),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

describe('MetricsService.getDesktopDocumentStatus', () => {
  let service: MetricsService;
  let prisma: DocMock;
  let fga: FgaMock;

  beforeEach(() => {
    ({ service, prisma, fga } = build());
  });

  it('feliz: devuelve status, rejectionReason, qaSignedAt y version con gate can_view', async () => {
    const qaSignedAt = new Date('2026-07-22T12:00:00Z');
    prisma.projectDocument.findUnique.mockResolvedValue({
      status: 'APROBADO',
      rejectionReason: null,
      qaSignedAt,
      version: 1,
      projectId: 'proj-1',
    });

    const result = await service.getDesktopDocumentStatus('u1', 'GMT-X-001');

    expect(fga.check).toHaveBeenCalledWith({
      user: 'user:u1',
      relation: 'can_view',
      object: 'project:proj-1',
    });
    expect(result).toEqual({
      status: 'APROBADO',
      rejectionReason: null,
      qaSignedAt,
      version: 1,
    });
  });

  it('404 si el documento no existe', async () => {
    prisma.projectDocument.findUnique.mockResolvedValue(null);
    await expect(service.getDesktopDocumentStatus('u1', 'GMT-NADA')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fga.check).not.toHaveBeenCalled();
  });

  it('I1 anti-enumeración: FGA deny responde el MISMO 404 que un código inexistente (nunca 403)', async () => {
    prisma.projectDocument.findUnique.mockResolvedValue({
      status: 'PENDIENTE_QA',
      rejectionReason: null,
      qaSignedAt: null,
      version: 0,
      projectId: 'proj-1',
    });
    fga.check.mockResolvedValue(false);

    await expect(
      service.getDesktopDocumentStatus('u1', 'GMT-X-001'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getDesktopDocumentStatus('u1', 'GMT-X-001'),
    ).rejects.toThrowError('No existe un documento con el código GMT-X-001.');
  });
});
