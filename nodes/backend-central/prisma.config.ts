// Config de Prisma CLI. Carga el .env de la RAÍZ del monorepo.
// Los comandos prisma deben ejecutarse desde nodes/backend-central (pnpm --filter @gmt-platform/backend-central ...).
import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: path.resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
