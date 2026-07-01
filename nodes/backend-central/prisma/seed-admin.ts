/**
 * Seed del administrador de organización (§1.1, prueba de la provisión).
 *
 * Idempotente. Asegura, para `admin@gmt.cl`:
 *  1. Postgres   — User (status ACTIVE, passwordHash bcrypt, 'Admin' 'GMT') +
 *                  Membership org_admin ORGANIZATION ORG_ID (espejo §4.1).
 *  2. OpenFGA    — tupla user:<id> admin organization:gmt (mismo mapeo §4.3 que
 *                  usa FgaService.syncMembershipToFGA).
 * Esto permite ejercer 1.1 (el admin puede llamar a /users).
 *
 * Ejecutar con: pnpm --filter @gmt-platform/backend-central seed:admin
 * Requiere: Postgres arriba, OpenFGA bootstrapeado (FGA_STORE_ID en .env).
 */
import path from 'node:path';
import { config } from 'dotenv';
import { OpenFgaClient } from '@openfga/sdk';
import { PrismaClient, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/common/password';

config({ path: path.resolve(process.cwd(), '../../.env') });

const ORG_ID = 'gmt';
const ADMIN = {
  email: 'admin@gmt.cl',
  password: 'AdminGmt2026',
  firstName: 'Admin',
  lastName: 'GMT',
  roleKey: 'org_admin',
} as const;

const prisma = new PrismaClient();

/** Asegura el User ACTIVE en Postgres con passwordHash bcrypt. Devuelve el id. */
async function ensurePostgresUser(): Promise<string> {
  const passwordHash = await hashPassword(ADMIN.password);
  const user = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: { firstName: ADMIN.firstName, lastName: ADMIN.lastName, status: UserStatus.ACTIVE, passwordHash },
    create: {
      email: ADMIN.email,
      firstName: ADMIN.firstName,
      lastName: ADMIN.lastName,
      status: UserStatus.ACTIVE,
      isClientUser: false,
      passwordHash,
    },
  });
  console.log(`Postgres: User asegurado ${user.email} (id ${user.id}, status ${user.status})`);
  return user.id;
}

/** Asegura la Membership org_admin ORGANIZATION ORG_ID. */
async function ensureMembership(userId: string): Promise<void> {
  await prisma.membership.upsert({
    where: {
      userId_roleKey_scopeType_scopeId: {
        userId,
        roleKey: ADMIN.roleKey,
        scopeType: 'ORGANIZATION',
        scopeId: ORG_ID,
      },
    },
    update: {},
    create: { userId, roleKey: ADMIN.roleKey, scopeType: 'ORGANIZATION', scopeId: ORG_ID },
  });
  console.log(`Postgres: Membership ${ADMIN.roleKey} ORGANIZATION:${ORG_ID} asegurada`);
}

/** Escribe la tupla FGA user:<id> admin organization:gmt (idempotente: ignora "ya existe"). */
async function ensureFgaTuple(userId: string): Promise<void> {
  const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';
  const storeId = process.env.FGA_STORE_ID;
  if (!storeId) {
    console.log('OpenFGA omitido: FGA_STORE_ID vacío. El login de desarrollo sigue funcionando sin la tupla.');
    return;
  }
  const modelId = process.env.FGA_MODEL_ID || undefined;
  const client = new OpenFgaClient({ apiUrl, storeId, authorizationModelId: modelId });
  const tuple = { user: `user:${userId}`, relation: 'admin', object: `organization:${ORG_ID}` };
  try {
    await client.write({ writes: [tuple] });
    console.log(`OpenFGA: tupla escrita ${tuple.user} ${tuple.relation} ${tuple.object}`);
  } catch (error: unknown) {
    // Extraer mensaje incluyendo campos extra del SDK de OpenFGA.
    const errObj = error as Record<string, unknown>;
    const message = [
      error instanceof Error ? error.message : String(error),
      typeof errObj['apiErrorCode'] === 'string' ? errObj['apiErrorCode'] : '',
      typeof errObj['apiErrorMessage'] === 'string' ? errObj['apiErrorMessage'] : '',
    ].join(' ');
    // write_failed_due_to_invalid_input cuando la tupla ya existe → idempotente.
    if (/already exists|write_failed_due_to_invalid_input|duplicate/i.test(message)) {
      console.log(`OpenFGA: tupla ya existía ${tuple.user} ${tuple.relation} ${tuple.object}`);
      return;
    }
    // Modelo de autorización obsoleto en .env → advertencia no fatal en dev.
    if (/authorization_model_not_found/i.test(message)) {
      console.warn('OpenFGA: FGA_MODEL_ID obsoleto — tupla no escrita. Actualiza FGA_MODEL_ID en .env o re-bootstrapea OpenFGA.');
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const userId = await ensurePostgresUser();
  await ensureMembership(userId);
  await ensureFgaTuple(userId);

  console.log('\n=== Credenciales del admin (compartir manualmente, §9) ===');
  console.log(`  email:    ${ADMIN.email}`);
  console.log(`  password: ${ADMIN.password}`);
  console.log('===========================================================');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
