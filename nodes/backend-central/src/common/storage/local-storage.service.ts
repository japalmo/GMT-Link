import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { StorageService } from './storage.service';
import type { StorageSaveInput, StorageSaveResult } from './storage.service';

/** Raíz en disco para los archivos en dev: `nodes/backend-central/var/uploads`. */
export const UPLOADS_ROOT = path.resolve(process.cwd(), 'var', 'uploads');

/** Tamaño máximo por archivo (10 MB) — configurable vía `STORAGE_MAX_BYTES`. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Implementación de `StorageService` para DESARROLLO: guarda en disco bajo
 * `nodes/backend-central/var/uploads/<folder>/` (carpeta ignorada por git). El `FilesController`
 * la sirve por HTTP. En prod se reemplaza por R2 (Decisión §9) sin tocar a los
 * consumidores.
 *
 * Seguridad:
 *  - el `filename` se SANITIZA (basename + whitelist de caracteres) para impedir
 *    path traversal al construir la clave;
 *  - el nombre final lleva un prefijo aleatorio (UUID) → sin colisiones ni
 *    sobrescritura;
 *  - el tamaño se valida contra un máximo configurable.
 */
@Injectable()
export class LocalStorageService extends StorageService {
  private readonly maxBytes: number = parseMaxBytes(process.env.STORAGE_MAX_BYTES);

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

    const folderDir = path.join(UPLOADS_ROOT, folder);
    await mkdir(folderDir, { recursive: true });
    await writeFile(path.join(folderDir, objectName), input.buffer);

    return { key, url: `${publicBaseUrl()}/files/${key}` };
  }

  async read(key: string): Promise<Buffer> {
    const absolute = resolveWithinUploads(key);
    if (absolute === null) {
      throw new NotFoundException(`Archivo no encontrado: "${key}".`);
    }
    try {
      return await readFile(absolute);
    } catch (error: unknown) {
      if (isFileNotFound(error)) {
        throw new NotFoundException(`Archivo no encontrado: "${key}".`);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const absolute = resolveWithinUploads(key);
    // Si la clave queda fuera de la raíz (manipulada) o el archivo no existe,
    // no se propaga el error: el borrado es best-effort e idempotente.
    if (absolute === null) {
      this.logger.warn(`Clave de storage fuera de la raíz, se omite borrado: "${key}".`);
      return;
    }
    try {
      await unlink(absolute);
    } catch (error: unknown) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
  }
}

/** Base pública para construir URLs (en dev apunta a este propio API). */
function publicBaseUrl(): string {
  return process.env.API_PUBLIC_URL ?? 'http://localhost:3001';
}

/** Parsea `STORAGE_MAX_BYTES`; valor inválido o ausente → default 10 MB. */
function parseMaxBytes(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_MAX_BYTES;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_BYTES;
}

/**
 * Sanitiza el nombre de archivo: toma SOLO el basename (descarta cualquier ruta),
 * reemplaza caracteres no seguros por '_' y acota el largo. Conserva la extensión
 * en la medida en que sobreviva al filtrado. Nunca puede contener separadores de
 * ruta ni '..'.
 */
export function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '') // sin punto(s) inicial(es) → evita nombres ocultos / '..'
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'archivo';
}

/** Sanitiza un segmento de carpeta lógica (sin separadores ni '..'). */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Resuelve una `key` a su ruta absoluta DENTRO de `UPLOADS_ROOT`.
 * Devuelve `null` si la ruta resuelta escapa de la raíz (defensa anti
 * path-traversal centralizada; la usan tanto el borrado como el controller).
 */
export function resolveWithinUploads(key: string): string | null {
  const absolute = path.resolve(UPLOADS_ROOT, key);
  const root = UPLOADS_ROOT + path.sep;
  if (absolute !== UPLOADS_ROOT && !absolute.startsWith(root)) {
    return null;
  }
  return absolute;
}

/** ¿El error es "archivo no encontrado" (ENOENT)? */
function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
