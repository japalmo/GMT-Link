/**
 * Escribe la tupla `can_manage_fleet` que faltaba para los usuarios que ya
 * tienen el rol de admin de vehículos.
 *
 * Por qué hace falta: `MEMBERSHIP_RELATION_MAP.ORGANIZATION` solo mapeaba
 * `org_admin`, así que asignar `vehicle_admin` no escribía ninguna tupla. El
 * usuario tenía el rol en la base y aun así FGA le negaba todo. El mapa ya está
 * corregido, pero las asignaciones HECHAS ANTES no tienen la tupla y nadie la
 * va a escribir sola.
 *
 * Idempotente: OpenFGA rechaza la tupla repetida y eso se trata como éxito.
 *
 * Uso: railway run pnpm exec tsx scripts/backfill-fleet-admin-tuples.ts
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { OpenFgaClient } from '@openfga/sdk';
import { ORG_ID } from '../src/common/org.constant';

config({ path: path.resolve(process.cwd(), '../../.env') });

const ROL = 'vehicle_admin';
const RELACION = 'can_manage_fleet';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const fga = new OpenFgaClient({
    apiUrl: process.env.FGA_API_URL!,
    storeId: process.env.FGA_STORE_ID!,
    authorizationModelId: process.env.FGA_MODEL_ID,
  });

  const memberships = await prisma.membership.findMany({
    where: { roleKey: ROL, scopeType: 'ORGANIZATION' },
    select: { userId: true, user: { select: { username: true } } },
  });
  console.log(`usuarios con el rol ${ROL}: ${memberships.length}`);

  for (const m of memberships) {
    const tupla = {
      user: `user:${m.userId}`,
      relation: RELACION,
      object: `organization:${ORG_ID}`,
    };
    try {
      await fga.write({ writes: [tupla] });
      console.log(`  ${m.user.username}: tupla escrita`);
    } catch (e) {
      const msg = String((e as Error).message);
      // Escribir una tupla que ya existe no es un error para lo que buscamos.
      if (/already exists|write_failed_due_to_invalid_input/i.test(msg)) {
        console.log(`  ${m.user.username}: la tupla ya existía`);
      } else {
        console.log(`  ${m.user.username}: FALLO -> ${msg.slice(0, 160)}`);
      }
    }
  }

  console.log('\nverificacion:');
  for (const m of memberships) {
    const r = await fga.check({
      user: `user:${m.userId}`,
      relation: RELACION,
      object: `organization:${ORG_ID}`,
    });
    console.log(`  ${m.user.username}: ${RELACION} = ${r.allowed}`);
  }
  await prisma.$disconnect();
}
void main();
