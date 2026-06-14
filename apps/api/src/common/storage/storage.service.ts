import { Injectable, Logger } from '@nestjs/common';

/** Datos de un archivo a persistir por el `StorageService`. */
export interface StorageSaveInput {
  /** Contenido binario del archivo. */
  buffer: Buffer;
  /** Nombre original (sin confiar — el storage lo sanitiza). */
  filename: string;
  /** MIME type validado por el caller (el storage no re-valida). */
  contentType: string;
  /** Carpeta lógica destino (ej. 'diplomas', 'documents'). */
  folder: string;
}

/** Resultado de persistir un archivo. */
export interface StorageSaveResult {
  /** Clave estable del objeto (ej. 'documents/abc123-cedula.pdf'); identifica el archivo. */
  key: string;
  /** URL pública (en dev la sirve `FilesController`; en prod, R2 firmada). */
  url: string;
}

/**
 * Almacenamiento de archivos enchufable (Decisión §9).
 *
 * Contrato abstracto: hoy lo satisface `LocalStorageService` (disco, solo dev).
 * Cuando se integre Cloudflare R2 (§2) se cambia el `useClass` en
 * `StorageModule`; los consumidores inyectan SIEMPRE este token abstracto y no
 * dependen del backend concreto. En prod R2 entregará URLs firmadas y el
 * `FilesController` dev desaparece.
 */
@Injectable()
export abstract class StorageService {
  protected readonly logger = new Logger(StorageService.name);

  /** Persiste un archivo y retorna su `key` estable + `url` de descarga. */
  abstract save(input: StorageSaveInput): Promise<StorageSaveResult>;

  /** Borra un archivo por su `key`. Idempotente: si no existe, no falla. */
  abstract delete(key: string): Promise<void>;
}
