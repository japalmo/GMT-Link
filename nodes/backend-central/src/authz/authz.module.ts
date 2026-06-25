import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FgaModule } from '../fga/fga.module';
import { PermissionService, SUPER_ADMIN_IDS } from './permission.service';

/**
 * Módulo de autorización (Módulo 4, ADR-0001). Provee la fachada única
 * `PermissionService` de forma GLOBAL, de modo que cualquier módulo la inyecte
 * sin import explícito. La lista de SuperAdmin viene de `SUPER_ADMIN_IDS` (env,
 * IDs separados por coma); vacía por defecto.
 */
@Global()
@Module({
  imports: [PrismaModule, FgaModule],
  providers: [
    PermissionService,
    {
      provide: SUPER_ADMIN_IDS,
      useValue: (process.env.SUPER_ADMIN_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  ],
  exports: [PermissionService],
})
export class AuthzModule {}
