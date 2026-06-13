/**
 * Helper de desarrollo (NO parte del producto): crea/actualiza en el EMULADOR de
 * Firebase el usuario espejo de colaborador@gtm.cl con emailVerified=true, tal como
 * lo haría el admin al aprovisionar cuentas (§1.1). Idempotente.
 * Requiere FIREBASE_AUTH_EMULATOR_HOST en el entorno.
 */
import path from 'node:path';
import { config } from 'dotenv';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

config({ path: path.resolve(process.cwd(), '../../.env') });

const EMAIL = 'colaborador@gtm.cl';
const PASSWORD = 'TempPass123';

async function main(): Promise<void> {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? 'demo-gtm-link';
  const app = getApps().length > 0 ? getApps()[0] : initializeApp({ projectId });
  const auth = getAuth(app);

  try {
    const existing = await auth.getUserByEmail(EMAIL);
    await auth.updateUser(existing.uid, { password: PASSWORD, emailVerified: true });
    console.log(`Usuario Firebase actualizado: ${EMAIL} (uid ${existing.uid})`);
  } catch {
    const created = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true });
    console.log(`Usuario Firebase creado: ${EMAIL} (uid ${created.uid})`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
