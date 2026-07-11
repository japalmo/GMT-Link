/**
 * Entrypoint del seed de usuarios MOCKUP (Fase 1e, spec §6).
 *
 * ⚠️ Mockups FICTICIOS de prueba (@example.test), SOLO para validar roles en
 * web-dev. Guardado por SEED_MOCKUPS (no por NODE_ENV: web-dev comparte api
 * prod). NUNCA cuentas reales — esas viven en Fase 3.
 *
 * Idempotente:
 *  - user.upsert por `username` (clave de login única, spec §4.1).
 *  - membership.upsert por su unique compuesto.
 *  - finanzas: delete-then-create acotado a los ids de los mockups.
 *
 * Requiere (ver plan §Prerequisites): campos username/emailInstitucional en User
 * (plan de auth) y los roles de la spec §2.3 sembrados (`pnpm db:seed`).
 *
 * Ejecutar:  $env:SEED_MOCKUPS='on'; pnpm --filter @gmt-platform/backend-central seed:mockups
 */
import path from 'node:path';
import { config } from 'dotenv';
import { OpenFgaClient } from '@openfga/sdk';
import { PrismaClient, ScopeType, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/common/password';
import {
  MOCKUPS,
  ORG_ID,
  ORG_ADMIN_ROLE,
  MOCKUP_PASSWORD,
  mockupEmail,
  isMockupSeedEnabled,
  buildReimbursements,
  buildOvertime,
} from './seed-mockups.core';

// Al correr con tsx hay que cargar el .env raíz manualmente (igual que seed.ts:18).
config({ path: path.resolve(process.cwd(), '../../.env') });

/** Cliente FGA opcional (best-effort). null si no hay store configurado. */
function makeFgaClient(): OpenFgaClient | null {
  const storeId = process.env.FGA_STORE_ID;
  if (!storeId) return null;
  const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';
  const modelId = process.env.FGA_MODEL_ID || undefined;
  return new OpenFgaClient({ apiUrl, storeId, authorizationModelId: modelId });
}

/** Resultado de escribir una tupla FGA (best-effort). */
type FgaWriteResult = 'ok' | 'exists' | 'model_missing' | 'error';

/**
 * Escribe una tupla de acceso org (member|admin), best-effort. No lanza: tolera
 * el "ya existe" (idempotencia; OpenFGA `write` no es idempotente) y el modelo
 * obsoleto (FGA_MODEL_ID viejo) de forma silenciosa — el caller decide el resumen.
 * Solo un error inesperado se avisa por-usuario.
 */
async function writeOrgTuple(
  client: OpenFgaClient,
  userId: string,
  relation: 'admin' | 'member',
): Promise<FgaWriteResult> {
  const tuple = { user: `user:${userId}`, relation, object: `organization:${ORG_ID}` };
  try {
    await client.write({ writes: [tuple] });
    return 'ok';
  } catch (error: unknown) {
    const errObj = error as Record<string, unknown>;
    const message = [
      error instanceof Error ? error.message : String(error),
      typeof errObj['apiErrorCode'] === 'string' ? errObj['apiErrorCode'] : '',
      typeof errObj['apiErrorMessage'] === 'string' ? errObj['apiErrorMessage'] : '',
    ].join(' ');
    if (/already exists|write_failed_due_to_invalid_input|duplicate/i.test(message)) return 'exists';
    if (/authorization_model_not_found/i.test(message)) return 'model_missing';
    console.warn(`  FGA: no se pudo escribir ${relation} para ${userId}: ${message}`);
    return 'error';
  }
}

async function main(): Promise<void> {
  if (!isMockupSeedEnabled(process.env)) {
    console.log(
      'seed:mockups OMITIDO — SEED_MOCKUPS no está activado. ' +
        "Para poblar web-dev: \"$env:SEED_MOCKUPS='on'; pnpm --filter @gmt-platform/backend-central seed:mockups\".",
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    // ── 0. Prerequisito: los roles de la spec §2.3 deben existir (FK Membership.roleKey). ──
    const neededRoles = [...new Set(MOCKUPS.map((m) => m.roleKey))];
    const foundRoles = await prisma.role.findMany({
      where: { key: { in: neededRoles } },
      select: { key: true },
    });
    const missing = neededRoles.filter((k) => !foundRoles.some((r) => r.key === k));
    if (missing.length > 0) {
      throw new Error(
        `Faltan roles en el catálogo: ${missing.join(', ')}. ` +
          'Corré `pnpm db:seed` (plan de roles, spec §2.3) antes de sembrar los mockups.',
      );
    }

    const passwordHash = await hashPassword(MOCKUP_PASSWORD);

    // ── 1. Usuarios MOCKUP (upsert por username). ──
    const idByUsername = new Map<string, string>();
    for (const m of MOCKUPS) {
      const email = mockupEmail(m.username);
      const user = await prisma.user.upsert({
        where: { username: m.username },
        update: {
          firstName: m.firstName,
          lastName: m.lastName,
          email,
          emailInstitucional: email,
          status: UserStatus.ACTIVE,
          passwordHash,
        },
        create: {
          username: m.username,
          email,
          emailInstitucional: email,
          firstName: m.firstName,
          lastName: m.lastName,
          status: UserStatus.ACTIVE,
          isClientUser: false,
          passwordHash,
        },
      });
      idByUsername.set(m.username, user.id);
    }
    console.log(`Usuarios MOCKUP asegurados: ${MOCKUPS.length}`);

    // ── 2. Membership ORGANIZATION por rol. ──
    for (const m of MOCKUPS) {
      const userId = idByUsername.get(m.username);
      if (userId === undefined) continue;
      await prisma.membership.upsert({
        where: {
          userId_roleKey_scopeType_scopeId: {
            userId,
            roleKey: m.roleKey,
            scopeType: ScopeType.ORGANIZATION,
            scopeId: ORG_ID,
          },
        },
        update: {},
        create: { userId, roleKey: m.roleKey, scopeType: ScopeType.ORGANIZATION, scopeId: ORG_ID },
      });
    }
    console.log(`Memberships ORGANIZATION aseguradas: ${MOCKUPS.length}`);

    // ── 3. Acceso FGA (best-effort): member para todos; admin solo para org_admin. ──
    //     RESOLUCIÓN #5: ningún mockup usa org_admin (el "admin TI" usa admin_ti,
    //     sin FGA admin), así que hoy solo se escriben tuplas `member`.
    const fga = makeFgaClient();
    if (!fga) {
      console.warn(
        'OpenFGA: FGA_STORE_ID vacío — se omiten las tuplas de acceso (los permisos FUNCTIONAL no dependen de FGA).',
      );
    } else {
      let modelMissing = false;
      for (const m of MOCKUPS) {
        const userId = idByUsername.get(m.username);
        if (userId === undefined) continue;
        const results: FgaWriteResult[] = [await writeOrgTuple(fga, userId, 'member')];
        if (m.roleKey === ORG_ADMIN_ROLE) {
          results.push(await writeOrgTuple(fga, userId, 'admin'));
        }
        if (results.includes('model_missing')) modelMissing = true;
      }
      if (modelMissing) {
        console.warn(
          'OpenFGA: FGA_MODEL_ID obsoleto — tuplas de acceso NO escritas (best-effort). ' +
            'Los permisos FUNCTIONAL de finanzas no dependen de FGA; re-bootstrapeá OpenFGA si necesitás el acceso org.',
        );
      } else {
        console.log('OpenFGA: tuplas de acceso org aseguradas (best-effort).');
      }
    }

    // ── 4. Data de juguete de finanzas (delete-then-create acotado a los mockups). ──
    const mockUserIds = [...idByUsername.values()];
    await prisma.reimbursement.deleteMany({ where: { userId: { in: mockUserIds } } });
    await prisma.overtimeRequest.deleteMany({ where: { userId: { in: mockUserIds } } });

    const now = new Date();
    const reimbursements = buildReimbursements(idByUsername, now);
    const overtime = buildOvertime(idByUsername, now);
    await prisma.reimbursement.createMany({ data: reimbursements });
    await prisma.overtimeRequest.createMany({ data: overtime });
    console.log(`Finanzas: ${reimbursements.length} reembolsos + ${overtime.length} horas extra de ejemplo.`);

    // ── 5. Resumen + credenciales para el owner. ──
    console.log(`\n=== Usuarios MOCKUP (web-dev) — clave: ${MOCKUP_PASSWORD} ===`);
    console.log('  (login por username; fallback email institucional @example.test)');
    for (const m of MOCKUPS) {
      console.log(`  ${m.username.padEnd(24)} rol=${m.roleKey.padEnd(20)} email=${mockupEmail(m.username)}`);
    }
    console.log('=====================================================================');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
