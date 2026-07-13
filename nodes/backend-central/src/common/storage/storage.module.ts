import { Global, Logger, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalStorageService } from './local-storage.service';
import { R2StorageService, isR2Configured } from './r2-storage.service';
import { StorageService } from './storage.service';

/**
 * Módulo global de almacenamiento de archivos (Decisión §9, enchufable).
 *
 * Liga el token abstracto `StorageService` a una implementación concreta elegida
 * en tiempo de arranque:
 *  - si las 5 variables `R2_*` están configuradas (`isR2Configured`) → `R2StorageService`
 *    (Cloudflare R2, DURABLE, apto para DEMs pesados);
 *  - si no → `LocalStorageService` (disco, efímero, solo dev) — retrocompatible: sin
 *    R2 en el entorno, todo sigue funcionando exactamente igual que antes.
 *
 * Los consumidores (CV, Documentos, DEMs) inyectan SIEMPRE el token abstracto y no
 * dependen del backend concreto.
 *
 * `@Global` para que cualquier módulo inyecte `StorageService` sin importarlo.
 * `FilesController` sirve los archivos por HTTP en dev (con R2 no aplica: URLs firmadas).
 */
@Global()
@Module({
  // Con R2 (prod) NO se monta: las descargas van por URL firmada de R2 y el endpoint
  // anónimo /files deja de existir (hallazgo de auditoría: servía boletas y documentos
  // personales SIN sesión). Solo en dev/local (LocalStorage) se monta para servir por HTTP.
  controllers: isR2Configured() ? [] : [FilesController],
  providers: [
    {
      provide: StorageService,
      useClass: isR2Configured() ? R2StorageService : LocalStorageService,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {
  constructor() {
    new Logger(StorageModule.name).log(
      `Backend de almacenamiento: ${isR2Configured() ? 'Cloudflare R2 (durable)' : 'LocalStorage (dev)'}.`,
    );
  }
}
