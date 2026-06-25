import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load .env from monorepo root BEFORE any NestJS/Prisma imports touch process.env
config({ path: resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Orígenes permitidos para CORS: configurable por env para Railway/producción.
  // `CORS_ORIGINS` = lista separada por comas (p. ej. "https://web.up.railway.app").
  // En dev cae al frontend local de Vite.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins });
  const port = Number(process.env.PORT ?? 3001);
  // Escuchar en 0.0.0.0 para que el contenedor de Railway acepte conexiones externas.
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
