/**
 * Entrypoint del seed del administrador de organización (§1.1).
 *
 * Idempotente. Asegura, para `admin@gmt.cl`:
 *  1. Postgres   — User + Membership org_admin ORGANIZATION ORG_ID (espejo §4.1).
 *  2. OpenFGA    — tupla user:<id> admin organization:gmt (§4.3).
 *
 * La lógica vive en `seed-admin.core.ts` (testeable, sin efectos secundarios).
 * Aquí sólo se carga el entorno, se crea el `PrismaClient` y se orquesta la
 * corrida, gestionando su desconexión.
 *
 * Ejecutar con: pnpm --filter @gmt-platform/backend-central seed:admin
 * Requiere: Postgres arriba, catálogo sembrado antes (`pnpm db:seed`) y, para
 * la tupla FGA, OpenFGA bootstrapeado (FGA_STORE_ID/FGA_MODEL_ID en env).
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { runAdminSeed } from './seed-admin.core';

config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

runAdminSeed(prisma, process.env)
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
