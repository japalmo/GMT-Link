import 'reflect-metadata';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { MetricsController } from '../../src/modules/metrics/metrics.controller';
import { MetricsService } from '../../src/modules/metrics/metrics.service';
import { OtpService } from '../../src/common/otp.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { EmailService } from '../../src/common/email.service';
import type { FgaService } from '../../src/fga/fga.service';
import type { StorageService } from '../../src/common/storage/storage.service';

/** Namespace que exige POST /metrics/documents para blob_path (clave, no URL). */
const NAMESPACE = /^metrics\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

interface UploadPrismaMock {
  $transaction: ReturnType<typeof vi.fn>;
  task: { findUnique: ReturnType<typeof vi.fn> };
  element: { findUnique: ReturnType<typeof vi.fn> };
  service: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  projectDocument: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
}

function build(): {
  controller: MetricsController;
  service: MetricsService;
  prisma: UploadPrismaMock;
  storageSave: ReturnType<typeof vi.fn>;
} {
  const prisma: UploadPrismaMock = {
    $transaction: vi.fn((ops: unknown) =>
      typeof ops === 'function' ? (ops as (tx: UploadPrismaMock) => unknown)(prisma) : Promise.resolve(ops),
    ),
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

  const fga = {
    check: vi.fn(() => Promise.resolve(true)),
    writeTuples: vi.fn(() => Promise.resolve()),
  };

  // Mimetiza la derivación de clave REAL de los storage concretos:
  // key = `${folder}/${customFilename}` (local y R2 comparten esa forma).
  const storageSave = vi.fn(
    (input: { folder: string; customFilename?: string; filename: string }) => {
      const name = input.customFilename ?? input.filename;
      return Promise.resolve({
        key: `${input.folder}/${name}`,
        url: `http://localhost:3001/files/${input.folder}/${name}`,
      });
    },
  );
  const storage = {
    save: storageSave,
    read: vi.fn(() => Promise.resolve(Buffer.from(''))),
    exists: vi.fn(() => Promise.resolve(true)),
    delete: vi.fn(() => Promise.resolve()),
  };

  const emailService = { send: vi.fn(() => Promise.resolve()) };
  const otp = new OtpService(prisma as unknown as PrismaService);
  const service = new MetricsService(
    prisma as unknown as PrismaService,
    emailService as unknown as EmailService,
    fga as unknown as FgaService,
    storage as unknown as StorageService,
    otp,
  );
  const controller = new MetricsController(
    service,
    fga as unknown as FgaService,
    storage as unknown as StorageService,
  );
  return { controller, service, prisma, storageSave };
}

/** Request falso: stream legible con headers, como el PUT crudo del escritorio. */
function fakeUploadRequest(body: Buffer): Request {
  const req = Object.assign(new Readable({ read() {} }), {
    headers: {
      'content-length': String(body.byteLength),
      'content-type': 'application/pdf',
    },
  });
  queueMicrotask(() => {
    req.push(body);
    req.push(null);
  });
  return req as unknown as Request;
}

describe('Circuito de subida del escritorio: blob_key en los responses (I6)', () => {
  let controller: MetricsController;
  let service: MetricsService;
  let prisma: UploadPrismaMock;
  let storageSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ controller, service, prisma, storageSave } = build());
  });

  it('getAssetUploadUrl incluye blob_key con la clave real del namespace (aditivo: blob_path se conserva)', async () => {
    const res = await service.getAssetUploadUrl({ filename: 'protocolo CR (final).pdf' });

    expect(res.blob_key).toMatch(NAMESPACE);
    // blob_path (URL legacy) se mantiene y apunta al MISMO archivo que la clave.
    expect(res.blob_path.endsWith(res.blob_key.slice('metrics/'.length))).toBe(true);
    expect(res.upload_url).toContain('token=');
    expect(res.asset_id).toBeTruthy();
  });

  it('PUT /metrics/upload responde blob_key con la clave real almacenada por el storage', async () => {
    const upload = await service.getAssetUploadUrl({ filename: 'protocolo.pdf' });
    const token = new URL(upload.upload_url).searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(0);

    const res = await controller.handleRawUpload(token, fakeUploadRequest(Buffer.from('pdf')));

    expect(res.success).toBe(true);
    expect(res.blob_key).toMatch(NAMESPACE);
    // La clave del response es EXACTAMENTE la que retornó storage.save (no una reconstrucción).
    const savedResult = (await storageSave.mock.results[0]?.value) as { key: string };
    expect(res.blob_key).toBe(savedResult.key);
    // Y coincide con la que getAssetUploadUrl anticipó.
    expect(res.blob_key).toBe(upload.blob_key);
  });

  it('la blob_key entregada pasa la validación de POST /metrics/documents (circuito completo)', async () => {
    const upload = await service.getAssetUploadUrl({ filename: 'protocolo.pdf' });
    prisma.task.findUnique.mockResolvedValue({
      id: 'task-1',
      projectId: 'proj-1',
      serviceId: 'serv-1',
    });

    const result = await service.createDesktopDocument('u1', {
      blob_path: upload.blob_key,
      file_hash: 'abc123',
      doc_type: 'CR',
      codigo: 'GMT-SQM-SD-P1-TOP-CR-GEN-002',
      task_id: 'task-1',
    });

    expect(result.success).toBe(true);
    expect(prisma.projectDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileUrl: upload.blob_key }),
      }),
    );
  });
});
