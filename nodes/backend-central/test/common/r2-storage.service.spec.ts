import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { R2StorageService } from '../../src/common/storage/r2-storage.service';

/** Env mínimo para instanciar el servicio (el cliente S3 se mockea; no hay red). */
const R2_TEST_ENV: Record<string, string> = {
  R2_ACCOUNT_ID: 'cuenta-test',
  R2_ACCESS_KEY_ID: 'ak-test',
  R2_SECRET_ACCESS_KEY: 'sk-test',
  R2_BUCKET: 'bucket-test',
  R2_ENDPOINT: 'https://cuenta-test.r2.cloudflarestorage.com',
};

interface SendMock {
  send: ReturnType<typeof vi.fn>;
}

function buildWithMockedClient(): { storage: R2StorageService; send: ReturnType<typeof vi.fn> } {
  const storage = new R2StorageService();
  const send = vi.fn();
  (storage as unknown as { client: SendMock }).client.send = send;
  return { storage, send };
}

/** Respuesta de GetObject del SDK: Body con transformToByteArray. */
function getObjectResponse(bytes: Buffer): { Body: { transformToByteArray: () => Promise<Uint8Array> } } {
  return { Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(bytes)) } };
}

describe('R2StorageService — readHead (GetObject con Range, sin transferir el objeto completo)', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(R2_TEST_ENV)) {
      vi.stubEnv(key, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pide SOLO los primeros bytes con Range bytes=0-(maxBytes-1) y devuelve el head', async () => {
    const { storage, send } = buildWithMockedClient();
    send.mockResolvedValue(getObjectResponse(Buffer.from('%PDF-1.7')));

    const head = await storage.readHead('metrics/uuid-protocolo.pdf', 8);

    expect(head.toString('utf8')).toBe('%PDF-1.7');
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'bucket-test',
      Key: 'metrics/uuid-protocolo.pdf',
      Range: 'bytes=0-7',
    });
  });

  it('404 (NotFoundException) cuando la clave no existe (NoSuchKey del SDK)', async () => {
    const { storage, send } = buildWithMockedClient();
    const noSuchKey = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    send.mockRejectedValue(noSuchKey);

    await expect(storage.readHead('metrics/no-existe.pdf', 8)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('objeto VACÍO (416 InvalidRange) → head vacío, que nunca calza con una firma mágica', async () => {
    const { storage, send } = buildWithMockedClient();
    const invalidRange = Object.assign(new Error('InvalidRange'), {
      name: 'InvalidRange',
      $metadata: { httpStatusCode: 416 },
    });
    send.mockRejectedValue(invalidRange);

    const head = await storage.readHead('metrics/vacio.pdf', 8);

    expect(head.byteLength).toBe(0);
  });

  it('404 (NotFoundException) si la respuesta llega sin Body', async () => {
    const { storage, send } = buildWithMockedClient();
    send.mockResolvedValue({ Body: undefined });

    await expect(storage.readHead('metrics/sin-body.pdf', 8)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
