import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Mensaje a enviar por un proveedor de email enchufable (§9).
 * `body` es SIEMPRE el texto plano (fallback). `html` es opcional: cuando el
 * caller pasa una plantilla branded, viaja como cuerpo HTML; si falta, el
 * proveedor deriva un HTML mínimo desde `body` (`textToHtml`).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

/**
 * Interfaz enchufable de envío de email (§9, decisión 1.1).
 *
 * DECISIÓN CERRADA: la provisión de usuarios NO envía email todavía; la clave
 * provisoria se RETORNA en la respuesta para que el admin la comparta. Este
 * contrato existe para enchufar un proveedor real (Brevo/SMTP/…) más adelante
 * sin tocar la lógica de negocio: cuando exista, se cambia el provider que
 * satisface `EmailService` por una implementación real.
 */
export abstract class EmailService {
  abstract send(message: EmailMessage): Promise<void>;
}

/** Escapa los cinco caracteres HTML sensibles para incrustar texto plano sin romper el markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML mínimo derivado del texto plano: escapa el contenido y lo envuelve en un
 * `<p>` (con saltos de línea a `<br>`). Es la red de seguridad para callers que
 * envían `body` sin una plantilla `html` acordada.
 */
export function textToHtml(text: string): string {
  return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

/**
 * Implementación por defecto: NO envía nada (solo registra en debug).
 * Es el placeholder hasta integrar un proveedor (§9). Mantener este no-op evita
 * que el resto del código dependa de un proveedor inexistente.
 */
@Injectable()
export class NoopEmailService extends EmailService {
  private readonly logger = new Logger(NoopEmailService.name);

  send(message: EmailMessage): Promise<void> {
    this.logger.debug(
      `EmailService no integrado (§9): se omite envío a ${message.to} ("${message.subject}").`,
    );
    return Promise.resolve();
  }
}

/**
 * Implementación real vía API HTTP de Brevo (D6, pivote anti-Railway).
 *
 * Railway BLOQUEA el SMTP saliente (nodemailer da ETIMEDOUT en la conexión), así
 * que el envío productivo se hace por HTTPS contra `api.brevo.com`. Se activa
 * cuando `BREVO_API_KEY` está configurada (tiene prioridad sobre SMTP en la
 * factory). Usa `AbortController` con timeout de 10s para NO colgar el request
 * que la originó si Brevo no responde.
 */
@Injectable()
export class BrevoEmailService extends EmailService {
  private readonly logger = new Logger(BrevoEmailService.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    super();
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      // Fail-fast en el arranque: la factory solo instancia este servicio si la
      // clave existe, pero lo verificamos para estrechar el tipo a `string`.
      throw new Error('BREVO_API_KEY no está configurada.');
    }
    this.apiKey = apiKey;
    this.from = process.env.EMAIL_FROM || 'no-reply@gmt.cl';
  }

  async send(message: EmailMessage): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.from, name: 'GMT Link' },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html ?? textToHtml(message.body),
          textContent: message.body,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // Red caída, DNS, o abort por timeout: se loguea y se propaga (fail-fast).
      this.logger.error(`Error al enviar email a ${message.to} vía Brevo:`, error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const errorMessage = `Brevo rechazó el envío a ${message.to}: HTTP ${res.status} ${res.statusText} ${detail}`.trim();
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    this.logger.log(`Email enviado con éxito a ${message.to} vía Brevo.`);
  }
}

/**
 * Implementación real usando SMTP (D6).
 * Se activa si `SMTP_HOST` está configurado y NO hay `BREVO_API_KEY`. En Railway
 * el SMTP saliente está bloqueado, por eso Brevo tiene prioridad; este camino
 * queda para entornos donde el SMTP sí sale (dev local, otros hosts).
 */
@Injectable()
export class SmtpEmailService extends EmailService {
  private readonly logger = new Logger(SmtpEmailService.name);
  private readonly transporter: Transporter;

  constructor() {
    super();
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
      // Fail-fast: sin estos timeouts nodemailer cuelga ~90s cuando el host
      // bloquea el SMTP saliente (Railway). Con 10s el fallo es rápido y visible.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    const from = process.env.EMAIL_FROM || 'no-reply@gmt.cl';
    try {
      await this.transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.body,
        html: message.html,
      });
      this.logger.log(`Email enviado con éxito a ${message.to}`);
    } catch (error) {
      this.logger.error(`Error al enviar email a ${message.to}:`, error);
      throw error;
    }
  }
}
