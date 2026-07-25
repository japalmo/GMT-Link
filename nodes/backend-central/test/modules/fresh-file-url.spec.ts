import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  freshFileUrl,
  isAbsoluteUrl,
  urlReferencesKey,
} from '../../src/common/storage/fresh-file-url';
import { R2StorageService } from '../../src/common/storage/r2-storage.service';
import type { StorageService } from '../../src/common/storage/storage.service';

/** Storage NO-R2 (dev/local o mock de specs): basta un objeto con la forma del token. */
const localStorageMock = {} as unknown as StorageService;

const R2_ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_ENDPOINT',
] as const;

/** Instancia un R2StorageService real (S3Client offline) con env de prueba. */
function buildR2(): R2StorageService {
  process.env.R2_ACCOUNT_ID = 'acc';
  process.env.R2_ACCESS_KEY_ID = 'ak';
  process.env.R2_SECRET_ACCESS_KEY = 'sk';
  process.env.R2_BUCKET = 'gmt-bucket';
  process.env.R2_ENDPOINT = 'https://acc.r2.cloudflarestorage.com';
  return new R2StorageService();
}

describe('isAbsoluteUrl', () => {
  it('detecta URLs http/https y rechaza claves de storage', () => {
    expect(isAbsoluteUrl('https://x.com/a.pdf')).toBe(true);
    expect(isAbsoluteUrl('http://localhost:3001/files/a.pdf')).toBe(true);
    expect(isAbsoluteUrl('documents/uuid-a.pdf')).toBe(false);
    expect(isAbsoluteUrl('users/u1/avatar/foto.png')).toBe(false);
  });
});

describe('urlReferencesKey', () => {
  it('true si el path de la URL termina en /<clave> (local y R2)', () => {
    expect(
      urlReferencesKey('http://localhost:3001/files/users/u1/avatar/f.png', 'users/u1/avatar/f.png'),
    ).toBe(true);
    expect(
      urlReferencesKey(
        'https://acc.r2.cloudflarestorage.com/gmt-bucket/users/u1/avatar/f.png?X-Amz-Signature=abc',
        'users/u1/avatar/f.png',
      ),
    ).toBe(true);
  });

  it('false para otra clave, URLs externas o valores no-URL', () => {
    expect(urlReferencesKey('https://x.com/otra/f.png', 'users/u1/avatar/f.png')).toBe(false);
    expect(urlReferencesKey('https://gravatar.com/avatar/abc', 'users/u1/avatar/f.png')).toBe(false);
    expect(urlReferencesKey('no-es-url', 'users/u1/avatar/f.png')).toBe(false);
  });
});

describe('freshFileUrl', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.API_PUBLIC_URL = process.env.API_PUBLIC_URL;
    for (const k of R2_ENV_KEYS) savedEnv[k] = process.env[k];
    delete process.env.API_PUBLIC_URL;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it('null y string vacío → null', async () => {
    expect(await freshFileUrl(localStorageMock, null)).toBeNull();
    expect(await freshFileUrl(localStorageMock, '')).toBeNull();
  });

  it('clave + storage local → URL del FilesController (API_PUBLIC_URL, default localhost)', async () => {
    expect(await freshFileUrl(localStorageMock, 'documents/uuid-a.pdf')).toBe(
      'http://localhost:3001/files/documents/uuid-a.pdf',
    );
    process.env.API_PUBLIC_URL = 'https://api.gmt.cl';
    expect(await freshFileUrl(localStorageMock, 'documents/uuid-a.pdf')).toBe(
      'https://api.gmt.cl/files/documents/uuid-a.pdf',
    );
  });

  it('URL absoluta legada/externa + storage local → passthrough', async () => {
    const legacy = 'http://localhost:3001/files/documents/viejo.pdf';
    expect(await freshFileUrl(localStorageMock, legacy)).toBe(legacy);
    const external = 'https://gravatar.com/avatar/abc';
    expect(await freshFileUrl(localStorageMock, external)).toBe(external);
  });

  it('clave + R2 → presigna con createPresignedGetUrl', async () => {
    const r2 = buildR2();
    const presign = vi
      .spyOn(r2, 'createPresignedGetUrl')
      .mockResolvedValue('https://firmada/fresca?sig=1');
    expect(await freshFileUrl(r2, 'diplomas/uuid-d.pdf')).toBe('https://firmada/fresca?sig=1');
    expect(presign).toHaveBeenCalledWith('diplomas/uuid-d.pdf');
  });

  it('URL firmada LEGADA del propio bucket R2 → re-presigna con la clave extraída', async () => {
    const r2 = buildR2();
    const presign = vi
      .spyOn(r2, 'createPresignedGetUrl')
      .mockResolvedValue('https://firmada/fresca?sig=2');
    const legacy =
      'https://acc.r2.cloudflarestorage.com/gmt-bucket/receipts/uuid-boleta.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=vencida';
    expect(await freshFileUrl(r2, legacy)).toBe('https://firmada/fresca?sig=2');
    expect(presign).toHaveBeenCalledWith('receipts/uuid-boleta.pdf');
  });

  it('URL absoluta ajena (otro host u otro bucket) + R2 → passthrough sin presignar', async () => {
    const r2 = buildR2();
    const presign = vi.spyOn(r2, 'createPresignedGetUrl');
    const otherHost = 'https://gravatar.com/avatar/abc';
    expect(await freshFileUrl(r2, otherHost)).toBe(otherHost);
    const otherBucket = 'https://acc.r2.cloudflarestorage.com/otro-bucket/receipts/b.pdf?X-Amz-Signature=x';
    expect(await freshFileUrl(r2, otherBucket)).toBe(otherBucket);
    expect(presign).not.toHaveBeenCalled();
  });
});

describe('R2StorageService.extractKeyFromUrl', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of R2_ENV_KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('extrae la clave de una URL firmada propia y decodifica percent-encoding', () => {
    const r2 = buildR2();
    expect(
      r2.extractKeyFromUrl(
        'https://acc.r2.cloudflarestorage.com/gmt-bucket/documents/uuid-c%C3%A9dula.pdf?X-Amz-Signature=x',
      ),
    ).toBe('documents/uuid-cédula.pdf');
  });

  it('null para URLs de otro host, otro bucket, sin clave o malformadas', () => {
    const r2 = buildR2();
    expect(r2.extractKeyFromUrl('https://otro.host/gmt-bucket/a.pdf')).toBeNull();
    expect(r2.extractKeyFromUrl('https://acc.r2.cloudflarestorage.com/otro-bucket/a.pdf')).toBeNull();
    expect(r2.extractKeyFromUrl('https://acc.r2.cloudflarestorage.com/gmt-bucket/')).toBeNull();
    expect(r2.extractKeyFromUrl('no-es-url')).toBeNull();
  });
});
