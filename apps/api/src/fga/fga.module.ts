import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenFgaClient } from '@openfga/sdk';
import { FgaService } from './fga.service';
import { FGA_CLIENT } from './fga.types';
import type { FgaClientLike } from './fga.types';

/**
 * Módulo global de autorización. Provee el cliente OpenFGA configurado desde el
 * entorno (FGA_API_URL/FGA_STORE_ID/FGA_MODEL_ID) y `FgaService`.
 * Lazy (§6-0.3): si falta `FGA_STORE_ID` la app igual bootea (health, etc.) y el
 * error claro se lanza recién al EJERCER un check, indicando correr el bootstrap.
 */
@Global()
@Module({
  providers: [
    {
      provide: FGA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FgaClientLike => {
        const apiUrl = config.get<string>('FGA_API_URL') ?? 'http://localhost:8080';
        const storeId = config.get<string>('FGA_STORE_ID');
        const authorizationModelId = config.get<string>('FGA_MODEL_ID') || undefined;

        if (!storeId) {
          const notConfigured = (): never => {
            throw new Error(
              'OpenFGA no inicializado: FGA_STORE_ID vacío. Ejecuta `pnpm --filter @gtm-link/api fga:bootstrap`.',
            );
          };
          return { check: notConfigured, write: notConfigured };
        }

        return new OpenFgaClient({ apiUrl, storeId, authorizationModelId });
      },
    },
    FgaService,
  ],
  exports: [FgaService],
})
export class FgaModule {}
