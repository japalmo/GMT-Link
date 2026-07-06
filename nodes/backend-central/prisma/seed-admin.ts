/**
 * Seed del administrador de organización (§1.1, prueba de la provisión).
 *
 * Idempotente. Asegura, para `admin@gmt.cl`:
 *  1. Postgres   — User + Membership org_admin ORGANIZATION ORG_ID (espejo §4.1).
 *  2. OpenFGA    — tupla user:<id> admin organization:gmt (§4.3).
 *
 * Credenciales según entorno (ver resolveAdminSeed):
 *  - dev:  clave fija pública `AdminGmt2026`, status ACTIVE (cómodo en local).
 *  - prod: `ADMIN_PASSWORD` si está definida; si no, una clave ALEATORIA
 *          impresa una sola vez. Status PENDING_FIRST_LOGIN para FORZAR el
 *          cambio de clave en el primer login (flujo /auth/first-login/complete).
 *          Nunca se re-baja el passwordHash de un admin ya existente en prod.
 *
 * Ejecutar con: pnpm --filter @gmt-platform/backend-central seed:admin
 * Requiere: Postgres arriba, catálogo sembrado antes (`pnpm db:seed`) y, para
 * la tupla FGA, OpenFGA bootstrapeado (FGA_STORE_ID/FGA_MODEL_ID en env).
 */
import path from 'node:path';
import { config } from 'dotenv';
import { OpenFgaClient } from '@openfga/sdk';
import { PrismaClient, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/common/password';
import { generateProvisionalPassword } from '../src/common/provisional-password';

config({ path: path.resolve(process.cwd(), '../../.env') });

const ORG_ID = 'gmt';
const ADMIN = {
  email: 'admin@gmt.cl',
  firstName: 'Admin',
  lastName: 'GMT',
  roleKey: 'org_admin',
} as const;

/** Clave fija SOLO para desarrollo local. Nunca se usa en producción. */
const DEV_PASSWORD = 'AdminGmt2026';

/** Resultado de la decisión de credenciales del admin según el entorno. */
export interface AdminSeedResolution {
  /** Clave en claro a sembrar (se hashea antes de persistir). */
  password: string;
  /** Estado inicial del User. PENDING_FIRST_LOGIN fuerza cambio de clave. */
  status: 'ACTIVE' | 'PENDING_FIRST_LOGIN';
  /** true si la clave fue generada aleatoriamente (para avisar en el log). */
  generated: boolean;
  /** true en producción: el admin debe cambiar la clave en el primer login. */
  mustChangePassword: boolean;
}

/**
 * Decide, de forma pura (testeable), con qué credenciales/estado se siembra el
 * admin. En prod jamás devuelve la clave pública fija.
 */
export function resolveAdminSeed(env: NodeJS.ProcessEnv): AdminSeedResolution {
  const isProd = env.NODE_ENV === 'production';
  if (!isProd) {
    return { password: DEV_PASSWORD, status: 'ACTIVE', generated: false, mustChangePassword: false };
  }
  const provided = env.ADMIN_PASSWORD?.trim();
  if (provided) {
    return { password: provided, status: 'PENDING_FIRST_LOGIN', generated: false, mustChangePassword: true };
  }
  return {
    password: generateProvisionalPassword(16),
    status: 'PENDING_FIRST_LOGIN',
    generated: true,
    mustChangePassword: true,
  };
}

const prisma = new PrismaClient();

/**
 * Asegura el User en Postgres. Devuelve `{ id, seededPassword }` donde
 * seededPassword es la clave a comunicar al admin (o null si el usuario ya
 * existía y en prod no se tocó su clave).
 */
async function ensurePostgresUser(
  resolution: AdminSeedResolution,
): Promise<{ id: string; seededPassword: string | null }> {
  const existing = await prisma.user.findUnique({
    where: { email: ADMIN.email },
    select: { id: true, status: true },
  });

  const isProd = process.env.NODE_ENV === 'production';

  // En prod, si el admin YA existe (cualquier estado), no re-bajamos su clave
  // ni su estado: evitamos invalidar la clave real que ya fijó, en cada release.
  if (existing && isProd) {
    await prisma.user.update({
      where: { email: ADMIN.email },
      data: { firstName: ADMIN.firstName, lastName: ADMIN.lastName },
    });
    console.log(
      `Postgres: User existente conservado ${ADMIN.email} (id ${existing.id}, status ${existing.status}) — clave NO modificada.`,
    );
    return { id: existing.id, seededPassword: null };
  }

  const passwordHash = await hashPassword(resolution.password);
  const statusValue =
    resolution.status === 'PENDING_FIRST_LOGIN'
      ? UserStatus.PENDING_FIRST_LOGIN
      : UserStatus.ACTIVE;

  const user = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: { firstName: ADMIN.firstName, lastName: ADMIN.lastName, status: statusValue, passwordHash },
    create: {
      email: ADMIN.email,
      firstName: ADMIN.firstName,
      lastName: ADMIN.lastName,
      status: statusValue,
      isClientUser: false,
      passwordHash,
    },
  });
  console.log(`Postgres: User asegurado ${user.email} (id ${user.id}, status ${user.status})`);
  return { id: user.id, seededPassword: resolution.password };
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

/** Escribe la tupla FGA user:<id> admin organization:gmt (idempotente). */
async function ensureFgaTuple(userId: string): Promise<void> {
  const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';
  const storeId = process.env.FGA_STORE_ID;
  if (!storeId) {
    console.log('OpenFGA omitido: FGA_STORE_ID vacío.');
    return;
  }
  const modelId = process.env.FGA_MODEL_ID || undefined;
  const client = new OpenFgaClient({ apiUrl, storeId, authorizationModelId: modelId });
  const tuple = { user: `user:${userId}`, relation: 'admin', object: `organization:${ORG_ID}` };
  try {
    await client.write({ writes: [tuple] });
    console.log(`OpenFGA: tupla escrita ${tuple.user} ${tuple.relation} ${tuple.object}`);
  } catch (error: unknown) {
    const errObj = error as Record<string, unknown>;
    const message = [
      error instanceof Error ? error.message : String(error),
      typeof errObj['apiErrorCode'] === 'string' ? errObj['apiErrorCode'] : '',
      typeof errObj['apiErrorMessage'] === 'string' ? errObj['apiErrorMessage'] : '',
    ].join(' ');
    if (/already exists|write_failed_due_to_invalid_input|duplicate/i.test(message)) {
      console.log(`OpenFGA: tupla ya existía ${tuple.user} ${tuple.relation} ${tuple.object}`);
      return;
    }
    if (/authorization_model_not_found/i.test(message)) {
      console.warn('OpenFGA: FGA_MODEL_ID obsoleto — tupla no escrita. Actualiza FGA_MODEL_ID o re-bootstrapea OpenFGA.');
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const resolution = resolveAdminSeed(process.env);
  const { id: userId, seededPassword } = await ensurePostgresUser(resolution);
  await ensureMembership(userId);
  await ensureFgaTuple(userId);

  if (seededPassword === null) {
    console.log('\n=== Admin ya existía en producción: no se muestran credenciales (clave sin cambios) ===');
    return;
  }

  console.log('\n=== Credenciales del admin (compartir manualmente, §9) ===');
  console.log(`  email:    ${ADMIN.email}`);
  console.log(`  password: ${seededPassword}`);
  if (resolution.generated) {
    console.log('  (clave generada aleatoriamente — se muestra UNA sola vez)');
  }
  if (resolution.mustChangePassword) {
    console.log('  status: PENDING_FIRST_LOGIN — el admin DEBE cambiar la clave en el primer login.');
  }
  console.log('===========================================================');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
