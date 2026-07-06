import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load .env from monorepo root BEFORE any NestJS/Prisma imports touch process.env
config({ path: resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { validateAuthJwtSecret } from './common/env';

async function bootstrap(): Promise<void> {
  // Fail-fast: aborta el arranque si AUTH_JWT_SECRET falta o es débil.
  validateAuthJwtSecret();
  const app = await NestFactory.create(AppModule);
  // Cabeceras de seguridad HTTP (X-Content-Type-Options, HSTS, etc.).
  // La API es JSON pura (sin HTML propio) → desactivamos la CSP por defecto
  // de helmet, que sólo aplica a documentos servidos por esta app; el resto
  // de cabeceras sí se aplican.
  app.use(helmet({ contentSecurityPolicy: false }));
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
