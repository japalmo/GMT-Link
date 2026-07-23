import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { StorageService } from './storage.service';
import type { StorageSaveInput, StorageSaveResult } from './storage.service';
import { sanitizeFilename } from './local-storage.service';

/** Tamaño máximo por archivo con R2 (600 MB) — apto para DEMs de decenas–cientos de MB. */
const DEFAULT_R2_MAX_BYTES = 600 * 1024 * 1024;

/** Vigencia por defecto de las URLs firmadas (1 hora) — configurable vía `R2_PRESIGN_TTL_SECONDS`. */
const DEFAULT_PRESIGN_TTL_SECONDS = 60 * 60;

/** Variables de entorno que definen la conexión a Cloudflare R2 (S3-compatible). */
interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

/**
 * ¿Están las 5 variables de R2 configuradas (no vacías)? Es el gate que decide, en
 * `StorageModule`, si se usa `R2StorageService` (durable) o el `LocalStorageService`
 * (efímero, dev). Sin R2 configurado, todo el sistema se comporta como antes.
 */
export function isR2Configured(): boolean {
  return readR2Env(process.env) !== null;
}

/** Lee y valida las env de R2; devuelve `null` si falta alguna (→ cae a local). */
function readR2Env(env: NodeJS.ProcessEnv): R2Env | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  const endpoint = env.R2_ENDPOINT?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

/** Parsea un entero positivo de env; valor inválido/ausente → default. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Implementación de `StorageService` sobre Cloudflare R2 (S3-compatible) para
 * almacenamiento DURABLE de DEMs y assets pesados. Reemplaza al
 * `LocalStorageService` (disco efímero, tope 10 MB) cuando las env `R2_*` están
 * presentes (ver `isR2Configured` + `StorageModule`).
 *
 * Respeta el contrato abstracto (`save`/`read`/`delete`) con las MISMAS firmas, de
 * modo que los consumidores que inyectan el token `StorageService` no se enteran
 * del backend. Añade además métodos específicos de R2 para URLs firmadas
 * (`createPresignedPutUrl`/`createPresignedGetUrl`), que el flujo de DEMs usa para
 * que el cliente de escritorio suba/descargue directo contra R2.
 */
@Injectable()
export class R2StorageService extends StorageService {
  private readonly env: R2Env;
  private readonly client: S3Client;
  private readonly maxBytes: number = parsePositiveInt(
    process.env.STORAGE_MAX_BYTES,
    DEFAULT_R2_MAX_BYTES,
  );
  private readonly presignTtlSeconds: number = parsePositiveInt(
    process.env.R2_PRESIGN_TTL_SECONDS,
    DEFAULT_PRESIGN_TTL_SECONDS,
  );

  constructor() {
    super();
    const env = readR2Env(process.env);
    if (env === null) {
      // Nunca debería ocurrir: el módulo solo instancia esta clase si isR2Configured().
      throw new Error('R2StorageService instanciado sin las variables R2_* configuradas.');
    }
    this.env = env;
    const config: S3ClientConfig = {
      region: 'auto',
      endpoint: env.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
    };
    this.client = new S3Client(config);
    this.logger.log(`R2StorageService activo (bucket=${env.bucket}).`);
  }

  /** Persiste un objeto en R2 (PutObject) y retorna su `key` estable + URL firmada de descarga. */
  async save(input: StorageSaveInput): Promise<StorageSaveResult> {
    if (input.buffer.byteLength > this.maxBytes) {
      throw new PayloadTooLargeException(
        `El archivo supera el máximo permitido (${this.maxBytes} bytes).`,
      );
    }

    const folder = sanitizeSegment(input.folder) || 'misc';
    const objectName = input.customFilename
      ? sanitizeFilename(input.customFilename)
      : `${randomUUID()}-${sanitizeFilename(input.filename)}`;
    const key = `${folder}/${objectName}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.contentType,
      }),
    );

    return { key, url: await this.createPresignedGetUrl(key) };
  }

  /** Lee el contenido binario de un objeto por su `key`. 404 si no existe. */
  async read(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.env.bucket, Key: key }),
      );
      if (!response.Body) {
        throw new NotFoundException(`Archivo no encontrado: "${key}".`);
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error: unknown) {
      if (isNoSuchKey(error)) {
        throw new NotFoundException(`Archivo no encontrado: "${key}".`);
      }
      throw error;
    }
  }

  /**
   * Lee A LO MÁS los primeros `maxBytes` bytes del objeto `key` con GetObject +
   * `Range: bytes=0-(maxBytes-1)` (sin transferir el objeto completo; pensado
   * para validar firmas mágicas como `%PDF-`). Un objeto VACÍO responde 416
   * InvalidRange en S3/R2 → se devuelve un buffer vacío (que nunca calza con
   * una firma). 404 si la clave no existe.
   */
  async readHead(key: string, maxBytes: number): Promise<Buffer> {
    const last = Math.max(1, Math.floor(maxBytes)) - 1;
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.env.bucket,
          Key: key,
          Range: `bytes=0-${last}`,
        }),
      );
      if (!response.Body) {
        throw new NotFoundException(`Archivo no encontrado: "${key}".`);
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error: unknown) {
      if (isInvalidRange(error)) {
        return Buffer.alloc(0);
      }
      if (isNoSuchKey(error)) {
        throw new NotFoundException(`Archivo no encontrado: "${key}".`);
      }
      throw error;
    }
  }

  /** ¿Existe el objeto `key` en el bucket? HEAD (sin transferir el contenido). */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.env.bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      if (isNoSuchKey(error)) {
        return false;
      }
      throw error;
    }
  }

  /** Borra un objeto por su `key`. Idempotente: R2 no falla si la clave no existe. */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.bucket, Key: key }));
  }

  /**
   * URL firmada de SUBIDA (PUT) para que el cliente cargue el objeto directo a R2
   * bajo `key`. Se usa en `createDemUploadUrl`: el cliente de escritorio hace PUT
   * del `.tif` a esta URL sin pasar el binario por el backend.
   */
  async createPresignedPutUrl(key: string, contentType?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.env.bucket,
        Key: key,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
      { expiresIn: this.presignTtlSeconds },
    );
  }

  /**
   * URL firmada de DESCARGA (GET) para un `key`/`blob_path` (ej. `dems/R2/MDE_R2.tif`).
   * Se usa en `getDemDownloadUrl`: el cliente descarga directo de R2 con una URL de
   * vigencia acotada.
   */
  async createPresignedGetUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.env.bucket, Key: key }),
      { expiresIn: this.presignTtlSeconds },
    );
  }
}

/** Sanitiza un segmento de carpeta lógica (sin separadores ni '..'). */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** ¿El error de S3/R2 es 416 InvalidRange (Range sobre un objeto vacío)? */
function isInvalidRange(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return name === 'InvalidRange' || status === 416;
}

/** ¿El error de S3/R2 indica que la clave no existe (NoSuchKey / 404)? */
function isNoSuchKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  const code = (error as { Code?: unknown }).Code;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || code === 'NoSuchKey' || status === 404;
}
