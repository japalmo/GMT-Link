/**
 * Otorga superusuario (rol `org_admin` @ORGANIZATION) a un usuario por username.
 *
 * `org_admin` da acceso total: el `PermissionService` lo trata como grant GLOBAL
 * (bypassa los checks funcionales) y en OpenFGA es `organization:gmt#admin` (bypassa
 * el check estructural por proyecto). Ver §9-1.1 del plan maestro y users.service
 * (`assignRole`): una Membership org-scope con roleKey='org_admin' + la tupla admin.
 *
 * El script:
 *  1) Crea la Membership org_admin (idempotente, upsert).
 *  2) Escribe la tupla FGA admin si hay acceso a FGA (tolerante a "ya existe"). Si
 *     FGA no es alcanzable desde aquí (host interno de Railway), NO es problema: el
 *     `fga-resync` que corre en cada boot del api la materializa desde la Membership.
 *
 * Uso (env DATABASE_URL apuntando al destino; FGA_* opcionales):
 *   tsx scripts/grant-superuser.ts [username]      # default: japalmo
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { OpenFgaClient } from '@openfga/sdk';
import { ORG_ID } from '../src/common/org.constant';

config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const username = process.argv[2] ?? 'japalmo';

  const user = await prisma.user.findFirst({
    where: { username },
    select: { id: true, username: true, firstName: true, lastName: true },
  });
  if (!user) {
    console.error(`Usuario "${username}" no encontrado.`);
    process.exit(1);
  }

  // 1) Membership org_admin @ORGANIZATION (idempotente).
  const membership = await prisma.membership.upsert({
    where: {
      userId_roleKey_scopeType_scopeId: {
        userId: user.id,
        roleKey: 'org_admin',
        scopeType: 'ORGANIZATION',
        scopeId: ORG_ID,
      },
    },
    create: {
      userId: user.id,
      roleKey: 'org_admin',
      scopeType: 'ORGANIZATION',
      scopeId: ORG_ID,
    },
    update: {},
  });

  // 2) Tupla FGA admin (best-effort: si FGA no es alcanzable, la escribe fga-resync al bootear).
  let fgaStatus: string;
  if (process.env.FGA_API_URL && process.env.FGA_STORE_ID) {
    const fga = new OpenFgaClient({
      apiUrl: process.env.FGA_API_URL,
      storeId: process.env.FGA_STORE_ID,
      authorizationModelId: process.env.FGA_MODEL_ID,
    });
    try {
      await fga.write({
        writes: [{ user: `user:${user.id}`, relation: 'admin', object: `organization:${ORG_ID}` }],
      });
      fgaStatus = 'escrita';
    } catch (e: unknown) {
      const m = (e instanceof Error ? e.message : String(e)) + JSON.stringify(e ?? {});
      fgaStatus = /already exists|duplicate|invalid_input/i.test(m)
        ? 'ya_existia'
        : `no_escrita (${m.slice(0, 120)}) -> la materializara fga-resync en el proximo boot`;
    }
  } else {
    fgaStatus = 'omitida (sin FGA_* env) -> la materializara fga-resync en el proximo boot';
  }

  console.log(
    `SUPERUSER ${user.username} (${user.firstName} ${user.lastName}) id=${user.id} :: ` +
      `membership=${membership.id} fga=${fgaStatus}`,
  );
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
