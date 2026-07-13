/**
 * Envía a los primeros usuarios reales su correo de credenciales (plantilla
 * onboardingCredentialsEmail: credenciales + disclaimer de usuarios de prueba) vía Brevo.
 * Lee las credenciales de un archivo JSON (no hardcodea PII/claves en el repo).
 *
 * Modos:
 *   --preview[=out.html]   Renderiza UN correo (con clave de MUESTRA) a un HTML y lista
 *                          los destinatarios. NO envía. No requiere BREVO_API_KEY.
 *   --to=<email>           Envía SOLO a ese destinatario (prueba). Requiere Brevo.
 *   (sin flag)             Envía a TODOS los del archivo. Requiere Brevo.
 *
 * Envío (hereda BREVO_API_KEY/EMAIL_FROM/APP_WEB_URL de Railway):
 *   railway run -s api -- pnpm -C nodes/backend-central exec tsx scripts/send-onboarding-credentials.ts --to=juanapalmo@gmail.com
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { onboardingCredentialsEmail } from '../src/common/email-templates';

const CREDS_FILE = process.env.CREDS_FILE || 'C:/Users/juana/GMT/backups/onboarding-creds.json';
const LOGIN_URL = 'https://web-production-c6320.up.railway.app/login';
const FEEDBACK_EMAIL = process.env.FEEDBACK_EMAIL || 'gestion@gmtingenieria.com';
const apiKey = process.env.BREVO_API_KEY;
const from = process.env.EMAIL_FROM || 'no-reply@gmt.cl';

interface Cred {
  nombre: string;
  username: string;
  email: string;
  roleKey: string;
  provisional: string;
}

function loadCreds(): Cred[] {
  const parsed: unknown = JSON.parse(readFileSync(CREDS_FILE, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error('El archivo de credenciales no es un array.');
  return parsed as Cred[];
}

async function sendOne(c: Cred): Promise<void> {
  const content = onboardingCredentialsEmail({
    nombre: c.nombre,
    username: c.username,
    provisionalPassword: c.provisional,
    loginUrl: LOGIN_URL,
    feedbackEmail: FEEDBACK_EMAIL,
  });
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey as string, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: 'GMT Link' },
      to: [{ email: c.email }],
      subject: content.subject,
      htmlContent: content.html,
      textContent: content.body,
    }),
  });
  const detail = await res.text();
  console.log(`  ${res.status} ${c.email} :: ${detail || '(ok)'}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const creds = loadCreds();

  const previewArg = args.find((a) => a.startsWith('--preview'));
  if (previewArg) {
    const sample = creds[0];
    if (!sample) throw new Error('El archivo de credenciales está vacío.');
    const out = previewArg.includes('=')
      ? previewArg.split('=')[1] ?? ''
      : 'C:/Users/juana/GMT/backups/preview-onboarding.html';
    const content = onboardingCredentialsEmail({
      nombre: sample.nombre,
      username: sample.username,
      provisionalPassword: 'Ab3x-Kf9m-Qr2t',
      loginUrl: LOGIN_URL,
      feedbackEmail: FEEDBACK_EMAIL,
    });
    writeFileSync(out, content.html, 'utf-8');
    console.log(`PREVIEW -> ${out}`);
    console.log(`Asunto: ${content.subject}`);
    console.log(`Login: ${LOGIN_URL}`);
    console.log(`Destinatarios (${creds.length}): ${creds.map((c) => `${c.nombre} <${c.email}>`).join(' | ')}`);
    return;
  }

  if (!apiKey || apiKey.trim().length === 0) {
    console.error('BREVO_API_KEY no disponible. Corre con: railway run -s api -- ...');
    process.exit(1);
  }

  // --test=<email>: envía UN correo de MUESTRA (creds ficticias) a esa dirección para
  // revisar el render real en la bandeja, sin tocar a los destinatarios reales.
  const testArg = args.find((a) => a.startsWith('--test='));
  if (testArg) {
    const testEmail = testArg.split('=')[1];
    if (!testEmail) {
      console.error('--test= requiere un email.');
      process.exit(1);
    }
    const sample = creds[0];
    if (!sample) {
      console.error('Sin credenciales en el archivo.');
      process.exit(1);
    }
    console.log(`Prueba (datos reales de ${sample.username}) a ${testEmail}. Login: ${LOGIN_URL}. Feedback: ${FEEDBACK_EMAIL}`);
    await sendOne({ ...sample, email: testEmail });
    return;
  }

  const onlyArg = args.find((a) => a.startsWith('--to='));
  const onlyEmail = onlyArg ? onlyArg.split('=')[1] : undefined;
  const targets = onlyEmail ? creds.filter((c) => c.email === onlyEmail) : creds;
  if (targets.length === 0) {
    console.error(`Sin destinatarios (--to=${onlyEmail ?? ''} no coincide).`);
    process.exit(1);
  }

  console.log(`Enviando ${targets.length} correo(s) desde ${from}. Login: ${LOGIN_URL}`);
  for (const c of targets) {
    await sendOne(c);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.log('Listo.');
}

void main();
