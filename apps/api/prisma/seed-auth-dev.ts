/**
 * Seed de desarrollo para AuthN (Etapa 0.5).
 * Crea (upsert por email) un usuario de prueba en Postgres en estado
 * PENDING_FIRST_LOGIN, para ejercer el flujo de primer login contra el emulador
 * de Firebase. El usuario equivalente EN el emulador lo crea el orquestador
 * durante la verificación; este script solo toca Postgres.
 *
 * Idempotente. Ejecutar con: pnpm --filter @gtm-link/api seed:auth-dev
 */
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, UserStatus } from '@prisma/client';

// Al correr con tsx hay que cargar el .env raíz manualmente (igual que seed.ts).
config({ path: path.resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();

const TEST_USER = {
  email: 'colaborador@gtm.cl',
  firstName: 'Colaborador',
  lastName: 'Prueba',
  status: UserStatus.PENDING_FIRST_LOGIN,
  isClientUser: false,
} as const;

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: TEST_USER.email },
    update: {
      firstName: TEST_USER.firstName,
      lastName: TEST_USER.lastName,
      status: TEST_USER.status,
      isClientUser: TEST_USER.isClientUser,
    },
    create: { ...TEST_USER },
  });
  console.log(`Usuario de prueba asegurado: ${user.email} (id=${user.id}, status=${user.status})`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
