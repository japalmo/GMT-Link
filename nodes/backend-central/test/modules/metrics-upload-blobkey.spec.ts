import 'reflect-metadata';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { MetricsController } from '../../src/modules/metrics/metrics.controller';
import { MetricsService } from '../../src/modules/metrics/metrics.service';
import { OtpService } from '../../src/common/otp.service';
import { LocalStorageService } from '../../src/common/storage/local-storage.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { EmailService } from '../../src/common/email.service';
import type { FgaService } from '../../src/fga/fga.service';

/** Namespace que exige POST /metrics/documents para blob_path (clave, no URL). */
const NAMESPACE = /^metrics\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

interface UploadPrismaMock {
  $transaction: ReturnType<typeof vi.fn>;
  task: { findUnique: ReturnType<typeof vi.fn> };
  element: { findUnique: ReturnType<typeof vi.fn> };
  service: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  projectDocument: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
}

interface Built {
  controller: MetricsController;
  service: MetricsService;
  prisma: UploadPrismaMock;
  storage: LocalStorageService;
  saveSpy: ReturnType<typeof vi.fn>;
}

function build(): Built {
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

  // Storage LOCAL REAL (patrón de local-storage.service.spec.ts): el PUT
  // re-sanitiza el nombre compuesto al guardar (objectName =
  // sanitizeFilename(customFilename), igual que R2); un mock que no lo haga
  // ocultaría la divergencia anticipada/real (I8).
  const storage = new LocalStorageService();
  const saveSpy = vi.spyOn(storage, 'save') as unknown as ReturnType<typeof vi.fn>;

  const emailService = { send: vi.fn(() => Promise.resolve()) };
  const otp = new OtpService(prisma as unknown as PrismaService);
  const service = new MetricsService(
    prisma as unknown as PrismaService,
    emailService as unknown as EmailService,
    fga as unknown as FgaService,
    storage,
    otp,
  );
  const controller = new MetricsController(service, fga as unknown as FgaService, storage);
  return { controller, service, prisma, storage, saveSpy };
}

/** Request falso: stream legible con headers, como el PUT crudo del escritorio. */
function fakeUploadRequest(body: Buffer, contentType = 'application/pdf'): Request {
  const req = Object.assign(new Readable({ read() {} }), {
    headers: {
      'content-length': String(body.byteLength),
      'content-type': contentType,
    },
  });
  queueMicrotask(() => {
    req.push(body);
    req.push(null);
  });
  return req as unknown as Request;
}

/** Cuerpo mínimo con la firma mágica de PDF que exige POST /metrics/documents (F4). */
const PDF_BODY = Buffer.from('%PDF-1.4\n%contenido de prueba');

function tokenOf(uploadUrl: string): string {
  return new URL(uploadUrl).searchParams.get('token') ?? '';
}

describe('Circuito de subida del escritorio: blob_key en los responses (I6/I8)', () => {
  let controller: MetricsController;
  let service: MetricsService;
  let prisma: UploadPrismaMock;
  let storage: LocalStorageService;
  let saveSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ controller, service, prisma, storage, saveSpy } = build());
  });

  afterEach(async () => {
    // Limpieza de los archivos reales escritos en var/uploads durante el test.
    for (const result of saveSpy.mock.results) {
      const saved = (await result.value) as { key: string };
      await storage.delete(saved.key);
    }
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
    const token = tokenOf(upload.upload_url);
    expect(token.length).toBeGreaterThan(0);

    const res = await controller.handleRawUpload(token, fakeUploadRequest(PDF_BODY));

    expect(res.success).toBe(true);
    expect(res.blob_key).toMatch(NAMESPACE);
    // La clave del response es EXACTAMENTE la que retornó storage.save (no una reconstrucción).
    const savedResult = (await saveSpy.mock.results[0]?.value) as { key: string };
    expect(res.blob_key).toBe(savedResult.key);
    // Y coincide con la que getAssetUploadUrl anticipó.
    expect(res.blob_key).toBe(upload.blob_key);
    // El objeto existe de verdad bajo esa clave.
    expect(await storage.exists(res.blob_key)).toBe(true);
  });

  it('I8: con nombre largo (84+ chars saneados) la clave anticipada sigue igual a la real y valida en POST /metrics/documents', async () => {
    // 96 chars + '.pdf' = 100 saneados; uuid(36) + '-' + 100 = 137 > 120 → el
    // storage trunca al guardar. La anticipada debe truncar IGUAL (punto fijo
    // de sanitizeFilename sobre el compuesto).
    const longName = `${'x'.repeat(96)}.pdf`;
    const upload = await service.getAssetUploadUrl({ filename: longName });
    const token = tokenOf(upload.upload_url);

    const res = await controller.handleRawUpload(token, fakeUploadRequest(PDF_BODY));

    expect(res.blob_key).toMatch(NAMESPACE);
    expect(res.blob_key).toBe(upload.blob_key); // anticipada === real
    expect(await storage.exists(res.blob_key)).toBe(true);

    // Y esa clave pasa la validación (y el check de existencia REAL) del registro.
    prisma.task.findUnique.mockResolvedValue({
      id: 'task-1',
      projectId: 'proj-1',
      serviceId: 'serv-1',
    });
    const result = await service.createDesktopDocument('u1', {
      blob_path: upload.blob_key,
      file_hash: 'abc123',
      doc_type: 'CR',
      codigo: 'GMT-SQM-SD-P1-TOP-CR-GEN-003',
      task_id: 'task-1',
    });
    expect(result.success).toBe(true);
    expect(prisma.projectDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileUrl: upload.blob_key }),
      }),
    );
  });

  it('la blob_key entregada pasa la validación de POST /metrics/documents (circuito completo con storage real)', async () => {
    const upload = await service.getAssetUploadUrl({ filename: 'protocolo.pdf' });
    await controller.handleRawUpload(tokenOf(upload.upload_url), fakeUploadRequest(PDF_BODY));
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

  it('n5: el token de subida es de un solo uso (segundo PUT con el mismo token → rechazado)', async () => {
    const upload = await service.getAssetUploadUrl({ filename: 'protocolo.pdf' });
    const token = tokenOf(upload.upload_url);

    const first = await controller.handleRawUpload(token, fakeUploadRequest(PDF_BODY));
    expect(first.success).toBe(true);

    await expect(
      controller.handleRawUpload(token, fakeUploadRequest(Buffer.from('reemplazo malicioso'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('F4: solo PDF real en el canal documental', () => {
    it('el PUT fuerza contentType application/pdf al guardar, ignorando el header del cliente', async () => {
      const upload = await service.getAssetUploadUrl({ filename: 'protocolo.pdf' });

      const res = await controller.handleRawUpload(
        tokenOf(upload.upload_url),
        fakeUploadRequest(PDF_BODY, 'text/html'),
      );

      expect(res.success).toBe(true);
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'metrics', contentType: 'application/pdf' }),
      );
    });

    it('circuito completo: un blob HTML subido por el canal NO se registra como documento (400 por firma mágica)', async () => {
      const upload = await service.getAssetUploadUrl({ filename: 'falso.pdf' });
      const html = Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>');
      const put = await controller.handleRawUpload(tokenOf(upload.upload_url), fakeUploadRequest(html));
      expect(put.success).toBe(true);

      prisma.task.findUnique.mockResolvedValue({
        id: 'task-1',
        projectId: 'proj-1',
        serviceId: 'serv-1',
      });

      await expect(
        service.createDesktopDocument('u1', {
          blob_path: upload.blob_key,
          file_hash: 'abc123',
          doc_type: 'CR',
          codigo: 'GMT-SQM-SD-P1-TOP-CR-GEN-004',
          task_id: 'task-1',
        }),
      ).rejects.toThrowError('El archivo no es un PDF válido.');
      expect(prisma.projectDocument.create).not.toHaveBeenCalled();
    });
  });
});
