import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load .env from monorepo root BEFORE any NestJS/Prisma imports touch process.env
config({ path: resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: 'http://localhost:5173' });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}
void bootstrap();
