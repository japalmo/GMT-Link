/**
 * Helper de desarrollo (NO parte del producto): crea/actualiza en el EMULADOR de
 * Firebase los usuarios MVP de los flujos Capstone y Albemarle, con clave conocida,
 * para poder loguear y demostrar cada rol. Idempotente.
 * Requiere FIREBASE_AUTH_EMULATOR_HOST en el entorno (localhost:9099 en dev).
 */
import path from 'node:path';
import { config } from 'dotenv';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

config({ path: path.resolve(process.cwd(), '../../.env') });

const PASSWORD = 'TempPass123';
const EMAILS = [
  // Capstone Copper / Mantos Blancos (operaciones, tareas/tiempos)
  'supervisor@capstone.cl',
  'operador@capstone.cl',
  'operador2@capstone.cl',
  'ito@capstone.cl',
  'adm@capstone.cl',
  // Albemarle / Salar de Atacama (v-metric, visor DEM)
  'supervisor@albemarle.cl',
  'operador@albemarle.cl',
  'ito@albemarle.cl',
  'adm@albemarle.cl',
];

async function main(): Promise<void> {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? 'demo-gmt-link';
  const app = getApps().length > 0 ? getApps()[0] : initializeApp({ projectId });
  const auth = getAuth(app);

  for (const email of EMAILS) {
    try {
      const existing = await auth.getUserByEmail(email);
      await auth.updateUser(existing.uid, { password: PASSWORD, emailVerified: true });
      console.log(`Actualizado: ${email}`);
    } catch {
      const created = await auth.createUser({ email, password: PASSWORD, emailVerified: true });
      console.log(`Creado: ${email} (uid ${created.uid})`);
    }
  }
  console.log(`\nClave para todos: ${PASSWORD}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
