/**
 * Lógica del seed del administrador de organización (§1.1), extraída del
 * entrypoint para ser testeable SIN efectos secundarios: este módulo no crea el
 * `PrismaClient` ni ejecuta nada al importarse. El entrypoint `seed-admin.ts`
 * inyecta el `PrismaClient` y orquesta la corrida contra Postgres/OpenFGA.
 *
 * Credenciales según entorno (ver resolveAdminSeed): NUNCA hay clave fija en el
 * repo. La clave sale de `ADMIN_PASSWORD`; si no está, se genera una ALEATORIA y
 * se imprime una sola vez.
 *  - dev:  status ACTIVE (cómodo en local; no fuerza cambio de clave).
 *  - prod: status PENDING_FIRST_LOGIN para FORZAR el cambio de clave en el primer
 *          login (flujo /auth/first-login/complete).
 *          Nunca se re-baja el passwordHash/estado de un admin ya existente (C3).
 */
import { OpenFgaClient } from '@openfga/sdk';
import { PrismaClient, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/common/password';
import { generateProvisionalPassword } from '../src/common/provisional-password';

export const ORG_ID = 'gmt';
export const ADMIN = {
  email: 'admin@gmt.cl',
  username: 'admin',
  firstName: 'Admin',
  lastName: 'GMT',
  roleKey: 'org_admin',
} as const;

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
 * admin. NUNCA hay clave fija en el repo: la clave sale de `ADMIN_PASSWORD` o,
 * si falta, de una aleatoria fuerte. Dev y prod comparten ese camino; sólo
 * difieren en el `status`/`mustChangePassword` (dev no fuerza el cambio).
 */
export function resolveAdminSeed(env: NodeJS.ProcessEnv): AdminSeedResolution {
  const isProd = env.NODE_ENV === 'production';
  const provided = env.ADMIN_PASSWORD?.trim();
  if (provided) {
    return {
      password: provided,
      status: isProd ? 'PENDING_FIRST_LOGIN' : 'ACTIVE',
      generated: false,
      mustChangePassword: isProd,
    };
  }
  // Sin ADMIN_PASSWORD: clave aleatoria impresa una vez (jamás una clave fija en el repo).
  return {
    password: generateProvisionalPassword(16),
    status: isProd ? 'PENDING_FIRST_LOGIN' : 'ACTIVE',
    generated: true,
    mustChangePassword: isProd,
  };
}

/**
 * Asegura el User en Postgres. Devuelve `{ id, seededPassword }` donde
 * seededPassword es la clave a comunicar al admin (o null si el usuario ya
 * existía y en prod no se tocó su clave).
 *
 * El `PrismaClient` se recibe por parámetro (inyección) para poder testear en
 * aislamiento la invariante C3. `isProd` se pasa explícito (lo resuelve el
 * caller a partir del entorno).
 */
export async function ensurePostgresUser(
  prisma: PrismaClient,
  resolution: AdminSeedResolution,
  isProd: boolean,
): Promise<{ id: string; seededPassword: string | null }> {
  const existing = await prisma.user.findUnique({
    where: { email: ADMIN.email },
    select: { id: true, status: true },
  });

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
      username: ADMIN.username,
      emailInstitucional: ADMIN.email,
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
export async function ensureMembership(prisma: PrismaClient, userId: string): Promise<void> {
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
export async function ensureFgaTuple(userId: string): Promise<void> {
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

/**
 * Orquesta el seed completo contra un `PrismaClient` inyectado y el entorno
 * dado. Idempotente. No gestiona el ciclo de vida del cliente (connect/
 * disconnect): eso es responsabilidad del entrypoint.
 */
export async function runAdminSeed(prisma: PrismaClient, env: NodeJS.ProcessEnv): Promise<void> {
  const resolution = resolveAdminSeed(env);
  const isProd = env.NODE_ENV === 'production';
  const { id: userId, seededPassword } = await ensurePostgresUser(prisma, resolution, isProd);
  await ensureMembership(prisma, userId);
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
