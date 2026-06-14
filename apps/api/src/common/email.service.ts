import { Injectable, Logger } from '@nestjs/common';

/** Mensaje a enviar por un proveedor de email enchufable (§9). */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * Interfaz enchufable de envío de email (§9, decisión 1.1).
 *
 * DECISIÓN CERRADA: la provisión de usuarios NO envía email todavía; la clave
 * provisoria se RETORNA en la respuesta para que el admin la comparta. Este
 * contrato existe para enchufar un proveedor real (SendGrid/SES/…) más adelante
 * sin tocar la lógica de negocio: cuando exista, se cambia el provider que
 * satisface `EmailService` por una implementación real.
 */
export abstract class EmailService {
  abstract send(message: EmailMessage): Promise<void>;
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
