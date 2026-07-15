import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load .env from monorepo root BEFORE any NestJS/Prisma imports touch process.env
config({ path: resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { validateAuthJwtSecret } from './common/env';

async function bootstrap(): Promise<void> {
  // Fail-fast: aborta el arranque si AUTH_JWT_SECRET falta o es débil.
  validateAuthJwtSecret();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Sube el límite del body JSON por sobre el default (~100 KB) para acomodar una
  // plantilla de checklist con un diagrama SVG embebido (el schema tope el SVG en
  // ~600 KB; 2 MB da margen para el resto del payload). Así un SVG dentro del
  // límite se guarda bien y uno demasiado grande devuelve un 400 claro del schema
  // (no un 413 opaco del body-parser).
  app.useBodyParser('json', { limit: '2mb' });
  // Detrás del proxy de Railway: confiar en 1 hop para que req.ip sea la IP real
  // del cliente (X-Forwarded-For). Sin esto el rate-limit por IP colapsa en un
  // único balde global y un atacante bloquea el login de todos. También habilita
  // HSTS correcto (helmet detecta https por el proxy).
  app.set('trust proxy', 1);
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
