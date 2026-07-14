import { escapeHtml } from './email.service';

/**
 * Plantillas de correo branded de GMT Link.
 *
 * Cada función devuelve `{ subject, body, html }`:
 *  - `subject` -> asunto del correo.
 *  - `body`    -> texto plano (fallback para clientes sin HTML).
 *  - `html`    -> cuerpo HTML con estilos INLINE (los clientes de correo no
 *                soportan `<style>` externo).
 *
 * Diseño: layout de tablas (máxima compatibilidad), tarjeta centrada acotada a
 * 480px, header BLANCO con el logo real (PNG alojado, único formato fiable en
 * correo: SVG y base64 los bloquean Gmail/Outlook), un acento azul marino de
 * marca (#2A2E63) y el dato destacado en una caja. Redacción en español chileno
 * formal (imperativo "tú": verifica, ingresa, usa). Todo valor dinámico se escapa
 * con `escapeHtml`.
 */

/** Contenido de un correo sin destinatario: el caller añade `to` al enviarlo. */
export interface EmailContent {
  subject: string;
  body: string;
  html: string;
}

/** Azul marino de la marca GMT (el del isotipo del logo). */
const BRAND_NAVY = '#2A2E63';

/**
 * URL pública del logo (PNG). Debe ser accesible por HTTPS: los correos no pueden
 * incrustar SVG ni base64 de forma fiable. Se sirve desde los assets estáticos del
 * frontend; configurable por env para apuntar al dominio de producción.
 */
const LOGO_URL =
  process.env.EMAIL_LOGO_URL ||
  'https://web-dev-production-05f2.up.railway.app/gmt-link-logo.png';

const FOOTER_NOTE = 'Este es un correo automático de GMT Link. No respondas a esta dirección.';

/** Envuelve el contenido interno en el shell branded (header con logo + cuerpo + footer). */
function shell(innerHtml: string): string {
  return `<div style="margin:0;padding:0;background-color:#eef1f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef1f6;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr>
            <td align="center" style="background-color:#ffffff;padding:26px 32px 20px;border-bottom:1px solid #eef1f6;">
              <img src="${escapeHtml(LOGO_URL)}" alt="GMT Link" height="34" style="height:34px;width:auto;display:block;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <tr>
            <td style="padding:30px 32px 26px;color:#1e293b;font-size:15px;line-height:1.6;">
${innerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background-color:#f8fafc;border-top:1px solid #eef1f6;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">${FOOTER_NOTE}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

/** Caja destacada con un código de 6 dígitos (grande, monospace, espaciado). */
function codeBox(code: string): string {
  return `<div style="margin:24px 0 12px;padding:22px 16px;background-color:#f4f6fb;border:1px solid #e2e8f0;border-radius:10px;text-align:center;">
                <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND_NAVY};font-family:'Courier New',Courier,monospace;">${escapeHtml(code)}</div>
              </div>
              <p style="margin:0;color:#64748b;font-size:13px;">Este código vence en <strong>5 minutos</strong>.</p>`;
}

/** Correo de verificación de un nuevo correo (OTP de 6 dígitos). */
export function verificationCodeEmail(code: string): EmailContent {
  const html = shell(`<p style="margin:0 0 12px;font-size:19px;font-weight:600;color:${BRAND_NAVY};">Verifica tu correo</p>
              <p style="margin:0;color:#475569;">Usa el siguiente código para confirmar tu dirección de correo en GMT Link:</p>
              ${codeBox(code)}
              <p style="margin:18px 0 0;color:#94a3b8;font-size:13px;">Si no solicitaste este código, ignora este mensaje.</p>`);

  return {
    subject: 'Verifica tu correo en GMT Link',
    body: `Tu código de verificación es ${code}. Vence en 5 minutos.\n\nSi no solicitaste este código, ignora este mensaje.`,
    html,
  };
}

/** Correo con el OTP para cambiar la contraseña. */
export function passwordChangeCodeEmail(code: string): EmailContent {
  const html = shell(`<p style="margin:0 0 12px;font-size:19px;font-weight:600;color:${BRAND_NAVY};">Cambio de contraseña</p>
              <p style="margin:0;color:#475569;">Ingresa este código para confirmar el cambio de tu contraseña en GMT Link:</p>
              ${codeBox(code)}
              <p style="margin:18px 0 0;color:#94a3b8;font-size:13px;">Si no solicitaste el cambio, ignora este mensaje y tu contraseña seguirá igual.</p>`);

  return {
    subject: 'Cambia tu contraseña en GMT Link',
    body: `Tu código para cambiar la contraseña es ${code}. Vence en 5 minutos.\n\nSi no solicitaste el cambio, ignora este mensaje y tu contraseña seguirá igual.`,
    html,
  };
}

/** Fila etiqueta/valor para la caja de credenciales. */
function credentialRow(label: string, value: string): string {
  return `<p style="margin:0 0 4px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(label)}</p>
                <p style="margin:0 0 16px;color:#0f172a;font-size:16px;font-weight:700;font-family:'Courier New',Courier,monospace;">${escapeHtml(value)}</p>`;
}

/** Correo con las credenciales de acceso (usuario + clave provisoria + login). */
export function credentialsEmail(params: {
  nombre: string;
  username: string;
  provisionalPassword: string;
  loginUrl: string;
}): EmailContent {
  const { nombre, username, provisionalPassword, loginUrl } = params;
  const safeLoginUrl = escapeHtml(loginUrl);

  const html = shell(`<p style="margin:0 0 12px;font-size:19px;font-weight:600;color:${BRAND_NAVY};">Hola ${escapeHtml(nombre)}:</p>
              <p style="margin:0;color:#475569;">Se creó tu cuenta en GMT Link. Estas son tus credenciales de acceso:</p>
              <div style="margin:24px 0;padding:22px 20px;background-color:#f4f6fb;border:1px solid #e2e8f0;border-radius:10px;">
                ${credentialRow('Usuario', username)}
                ${credentialRow('Clave provisoria', provisionalPassword)}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                <tr>
                  <td style="background-color:${BRAND_NAVY};border-radius:8px;">
                    <a href="${safeLoginUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Ingresar a GMT Link</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px;color:#475569;font-size:14px;">O copia este enlace en tu navegador:</p>
              <p style="margin:0 0 20px;"><a href="${safeLoginUrl}" style="color:${BRAND_NAVY};font-size:13px;word-break:break-all;">${safeLoginUrl}</a></p>
              <p style="margin:0;color:#b45309;font-size:13px;background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;">Por seguridad, cambia tu contraseña en tu primer ingreso.</p>`);

  return {
    subject: 'Tus credenciales de acceso a GMT Link',
    body: `Hola ${nombre}:

Se creó tu cuenta en GMT Link. Tus credenciales de acceso son:

Usuario: ${username}
Clave provisoria: ${provisionalPassword}

Ingresa en: ${loginUrl}

Por seguridad, cambia tu contraseña en tu primer ingreso.`,
    html,
  };
}

/** Convierte texto plano (con saltos de línea) en párrafos HTML escapados. */
function messageToHtml(message: string): string {
  return message
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map(
      (para) =>
        `<p style="margin:0 0 14px;color:#475569;">${escapeHtml(para).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
}

/**
 * Correo de REENVÍO de clave con asunto y mensaje EDITABLES por el admin. El
 * cuerpo del mensaje (intro) lo redacta el admin en la UI; la caja de credenciales
 * (usuario + clave provisoria) y el botón de ingreso los arma el servidor con la
 * clave recién regenerada — la clave nunca pasa por el front. Reutiliza el shell
 * branded. `message` cae a un texto por defecto si el admin lo deja vacío.
 */
export function resendCredentialsEmail(params: {
  nombre: string;
  username: string;
  provisionalPassword: string;
  loginUrl: string;
  subject: string;
  message: string;
}): EmailContent {
  const { nombre, username, provisionalPassword, loginUrl, subject, message } = params;
  const safeLoginUrl = escapeHtml(loginUrl);
  const trimmedMessage = message.trim();
  const introHtml =
    trimmedMessage.length > 0
      ? messageToHtml(trimmedMessage)
      : `<p style="margin:0;color:#475569;">Te reenviamos tus credenciales de acceso a GMT Link.</p>`;

  const html = shell(`<p style="margin:0 0 12px;font-size:19px;font-weight:600;color:${BRAND_NAVY};">Hola ${escapeHtml(nombre)}:</p>
              ${introHtml}
              <div style="margin:24px 0;padding:22px 20px;background-color:#f4f6fb;border:1px solid #e2e8f0;border-radius:10px;">
                ${credentialRow('Usuario', username)}
                ${credentialRow('Clave provisoria', provisionalPassword)}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                <tr>
                  <td style="background-color:${BRAND_NAVY};border-radius:8px;">
                    <a href="${safeLoginUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Ingresar a GMT Link</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px;color:#475569;font-size:14px;">O copia este enlace en tu navegador:</p>
              <p style="margin:0 0 20px;"><a href="${safeLoginUrl}" style="color:${BRAND_NAVY};font-size:13px;word-break:break-all;">${safeLoginUrl}</a></p>
              <p style="margin:0;color:#b45309;font-size:13px;background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;">Por seguridad, cambia tu contraseña en tu primer ingreso.</p>`);

  const bodyIntro = trimmedMessage.length > 0 ? trimmedMessage : 'Te reenviamos tus credenciales de acceso a GMT Link.';
  return {
    subject: subject.trim().length > 0 ? subject.trim() : 'Tus credenciales de acceso a GMT Link',
    body: `Hola ${nombre}:

${bodyIntro}

Usuario: ${username}
Clave provisoria: ${provisionalPassword}

Ingresa en: ${loginUrl}

Por seguridad, cambia tu contraseña en tu primer ingreso.`,
    html,
  };
}

/** Texto por defecto del mensaje de reenvío de clave (editable por el admin en la UI). */
export function defaultResendMessage(): string {
  return 'Te reenviamos tus credenciales de acceso a GMT Link. Usa el usuario y la clave provisoria que aparecen más abajo para ingresar. Por seguridad, deberás cambiar tu clave en el primer ingreso.';
}

/**
 * Credenciales + aviso de que son los PRIMEROS usuarios de prueba (piloto): invita a
 * dar feedback y aclara que pueden existir errores aún no detectados. Reutiliza el
 * shell branded y agrega un bloque informativo antes del aviso de seguridad.
 */
export function onboardingCredentialsEmail(params: {
  nombre: string;
  username: string;
  provisionalPassword: string;
  loginUrl: string;
  feedbackEmail: string;
}): EmailContent {
  const { nombre, username, provisionalPassword, loginUrl, feedbackEmail } = params;
  // El link precarga usuario y clave en el login (?u=&p=). El login los lee y limpia la
  // URL enseguida (history.replaceState) para que no queden en el historial/barra. Son
  // claves provisorias que se cambian al primer ingreso.
  const prefillUrl = `${loginUrl}?u=${encodeURIComponent(username)}&p=${encodeURIComponent(provisionalPassword)}`;
  const safePrefillUrl = escapeHtml(prefillUrl);
  const safeLoginUrl = escapeHtml(loginUrl);
  const disclaimer =
    `Eres parte del primer grupo de usuarios de prueba de GMT Link. Es normal que encuentres detalles por pulir o errores que aún no alcanzamos a detectar. Si algo no funciona como esperas, escríbenos a ${feedbackEmail} y cuéntanos qué pasó: tu opinión nos ayuda a mejorar la plataforma antes del lanzamiento general. Gracias por probar.`;

  const html = shell(`<p style="margin:0 0 12px;font-size:19px;font-weight:600;color:${BRAND_NAVY};">Hola ${escapeHtml(nombre)}:</p>
              <p style="margin:0;color:#475569;">Se creó tu cuenta en GMT Link y eres parte del primer grupo de usuarios de prueba. Estas son tus credenciales de acceso:</p>
              <div style="margin:24px 0;padding:22px 20px;background-color:#f4f6fb;border:1px solid #e2e8f0;border-radius:10px;">
                ${credentialRow('Usuario', username)}
                ${credentialRow('Clave provisoria', provisionalPassword)}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                <tr>
                  <td style="background-color:${BRAND_NAVY};border-radius:8px;">
                    <a href="${safePrefillUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Ingresar a GMT Link</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px;color:#475569;font-size:14px;">O copia este enlace en tu navegador:</p>
              <p style="margin:0 0 20px;"><a href="${safeLoginUrl}" style="color:${BRAND_NAVY};font-size:13px;word-break:break-all;">${safeLoginUrl}</a></p>
              <p style="margin:0 0 14px;color:#1e3a5f;font-size:13px;line-height:1.55;background-color:#eef2fb;border:1px solid #c7d2fe;border-radius:8px;padding:13px 15px;">${escapeHtml(disclaimer)}</p>
              <p style="margin:0;color:#b45309;font-size:13px;background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;">Por seguridad, cambia tu contraseña en tu primer ingreso.</p>`);

  return {
    subject: 'Tus credenciales de acceso a GMT Link (usuario de prueba)',
    body: `Hola ${nombre}:

Se creó tu cuenta en GMT Link y eres parte del primer grupo de usuarios de prueba. Tus credenciales de acceso son:

Usuario: ${username}
Clave provisoria: ${provisionalPassword}

Ingresa en: ${loginUrl}

${disclaimer}

Por seguridad, cambia tu contraseña en tu primer ingreso.`,
    html,
  };
}
