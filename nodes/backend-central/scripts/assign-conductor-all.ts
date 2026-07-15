/**
 * Asigna el rol de sistema `conductor` (Membership @ORGANIZATION, scopeId 'gmt')
 * a TODOS los usuarios internos (isClientUser=false) que aún no lo tengan.
 *
 * `conductor` es un rol COMPLEMENTARIO (asset:use:report + asset:checklist:run:any,
 * ambos GLOBAL): habilita tomar/liberar vehículos de la flota y ejecutar su
 * checklist. No reemplaza el rol base del trabajador ni toca OpenFGA (los grants
 * son FUNCTIONAL puros; los resuelve PermissionService contra Postgres).
 *
 * Idempotente: upsert por el unique compuesto (userId, roleKey, scopeType, scopeId);
 * correrlo dos veces no duplica nada. Excluye a los usuarios cliente (client_ito).
 *
 * Requiere el catálogo sembrado (prisma/seed.ts) con el rol `conductor`; si no
 * existe, aborta con instrucciones.
 *
 * Uso (env DATABASE_URL apuntando al destino):
 *   tsx scripts/assign-conductor-all.ts
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ORG_ID } from '../src/common/org.constant';

config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();
const ROLE_KEY = 'conductor';

async function main(): Promise<void> {
  // El rol debe existir en el catálogo (seed corrido) para que la Membership
  // resuelva grants: sin Role/RolePermission el PermissionService deniega.
  const role = await prisma.role.findUnique({ where: { key: ROLE_KEY } });
  if (!role) {
    console.error(
      `El rol "${ROLE_KEY}" no existe en la BD. Corre primero el seed del catálogo ` +
        `(pnpm --filter backend-central exec tsx prisma/seed.ts) y reintenta.`,
    );
    process.exit(1);
  }

  const internalUsers = await prisma.user.findMany({
    where: { isClientUser: false },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  });

  let created = 0;
  let alreadyHad = 0;

  for (const user of internalUsers) {
    const existing = await prisma.membership.findUnique({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId: user.id,
          roleKey: ROLE_KEY,
          scopeType: 'ORGANIZATION',
          scopeId: ORG_ID,
        },
      },
      select: { id: true },
    });

    if (existing) {
      alreadyHad += 1;
      continue;
    }

    // Upsert (no create) por si otro proceso lo asigna entre el check y aquí.
    await prisma.membership.upsert({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId: user.id,
          roleKey: ROLE_KEY,
          scopeType: 'ORGANIZATION',
          scopeId: ORG_ID,
        },
      },
      create: {
        userId: user.id,
        roleKey: ROLE_KEY,
        scopeType: 'ORGANIZATION',
        scopeId: ORG_ID,
      },
      update: {},
    });
    created += 1;
    console.log(`  + conductor -> ${user.username}`);
  }

  console.log(
    `\nCONDUCTOR asignado. Usuarios internos: ${internalUsers.length} | ` +
      `nuevas membresías: ${created} | ya lo tenían: ${alreadyHad}.`,
  );
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
