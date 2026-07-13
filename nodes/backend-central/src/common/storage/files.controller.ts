import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { resolveWithinUploads } from './local-storage.service';

/**
 * Content-Type por extensión para los tipos que este MVP almacena (PDF +
 * imágenes de documentos/diplomas). Mapa local minimalista para no depender de
 * `mime-types` (no es dependencia directa del paquete). Desconocida →
 * `application/octet-stream`.
 */
const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
};

/**
 * Sirve archivos del storage LOCAL por su `key` (SOLO DEV).
 *
 * Público: SIN `@RequirePermission` — los archivos se referencian por URL directa
 * (para que un <img src="/files/…"> del front cargue sin cabecera de auth). Por eso
 * el `StorageModule` NO lo monta cuando R2 está configurado (prod): ahí Cloudflare R2
 * entrega URLs firmadas con expiración y el acceso se controla en R2 (Decisión §9).
 * Solo existe en dev/local (LocalStorage), donde el host no es internet-facing.
 *
 * Anti path-traversal: la ruta absoluta se resuelve y se verifica que quede
 * DENTRO de `var/uploads`; cualquier intento de escapar (../, ruta absoluta)
 * cae en 404, nunca se filtra un archivo fuera de la raíz.
 */
@Controller('files')
export class FilesController {
  /**
   * `*path` captura la `key` completa con sus '/' (ej. `documents/uuid-cedula.pdf`).
   * Las claves llevan UUID → inmutables; cache corto y privado en dev.
   */
  @Get('*path')
  @Header('Cache-Control', 'private, max-age=300')
  async serve(@Param('path') pathParam: string | string[]): Promise<StreamableFile> {
    const key = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const absolute = resolveWithinUploads(key);
    if (absolute === null) {
      throw new NotFoundException('Archivo no encontrado.');
    }

    let isFile = false;
    try {
      isFile = (await stat(absolute)).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      throw new NotFoundException('Archivo no encontrado.');
    }

    const ext = path.extname(absolute).toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
    return new StreamableFile(createReadStream(absolute), { type: contentType });
  }
}
