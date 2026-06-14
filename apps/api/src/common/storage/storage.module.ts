import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalStorageService } from './local-storage.service';
import { StorageService } from './storage.service';

/**
 * Módulo global de almacenamiento de archivos (Decisión §9, enchufable).
 *
 * Liga el token abstracto `StorageService` a `LocalStorageService` (disco, dev).
 * Para producción se cambia SOLO el `useClass` por la implementación de R2; los
 * consumidores (CV, Documentos) inyectan el token abstracto y no se enteran.
 *
 * `@Global` para que cualquier módulo inyecte `StorageService` sin importarlo.
 * `FilesController` sirve los archivos por HTTP en dev (en prod no aplica: R2).
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [{ provide: StorageService, useClass: LocalStorageService }],
  exports: [StorageService],
})
export class StorageModule {}
