/**
 * Envía los 3 correos branded de GMT Link (verificación, cambio de clave,
 * credenciales) a un destinatario de prueba, usando los TEMPLATES REALES y la API
 * de Brevo. Pensado para correrse con `railway run -s api` para heredar
 * BREVO_API_KEY / EMAIL_FROM / EMAIL_LOGO_URL sin exponer secretos.
 *
 *   railway run -s api -- pnpm -C nodes/backend-central exec tsx scripts/send-test-emails.ts
 *
 * Destinatario por env TEST_EMAIL_TO (default juanapalmo@gmail.com).
 */
import {
  verificationCodeEmail,
  passwordChangeCodeEmail,
  credentialsEmail,
  type EmailContent,
} from '../src/common/email-templates';

const apiKey = process.env.BREVO_API_KEY;
const from = process.env.EMAIL_FROM || 'no-reply@gmt.cl';
const to = process.env.TEST_EMAIL_TO || 'juanapalmo@gmail.com';

async function send(content: EmailContent): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey as string,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: from, name: 'GMT Link' },
      to: [{ email: to }],
      subject: `[PRUEBA] ${content.subject}`,
      htmlContent: content.html,
      textContent: content.body,
    }),
  });
  const detail = await res.text();
  console.log(`  ${res.status} ${res.statusText} :: ${content.subject} :: ${detail || '(ok)'}`);
}

async function main(): Promise<void> {
  if (!apiKey || apiKey.trim().length === 0) {
    console.error('BREVO_API_KEY no está disponible en el entorno. Corre con `railway run -s api`.');
    process.exit(1);
  }
  console.log(`Enviando 3 correos de prueba a ${to} (from: ${from})`);
  console.log(`Logo: ${process.env.EMAIL_LOGO_URL || '(default web-dev)'}`);
  await send(verificationCodeEmail('123456'));
  await send(passwordChangeCodeEmail('654321'));
  await send(
    credentialsEmail({
      nombre: 'Juana',
      username: 'jpalmo',
      provisionalPassword: 'GmtDemo2026!',
      loginUrl: 'https://web-dev-production-05f2.up.railway.app/login',
    }),
  );
  console.log('Listo.');
}

void main();
