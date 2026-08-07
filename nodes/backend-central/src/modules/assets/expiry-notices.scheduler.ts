import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ExpiryNoticesService } from './expiry-notices.service';

/**
 * Dispara el barrido de vencimientos una vez al día.
 *
 * A las 08:00 de Chile continental a propósito: el aviso llega al empezar la
 * jornada, cuando alguien puede hacer algo con él, y no de madrugada donde se
 * pierde entre lo de la noche.
 *
 * Corre DENTRO del proceso de la API. Es lo que corresponde acá: el servicio
 * está siempre levantado y el plan de Railway no ofrece tareas programadas
 * propias. La contrapartida es que con varias instancias el barrido correría en
 * todas; hoy hay una sola, y aunque hubiera más, el registro de avisos enviados
 * hace que la segunda no duplique nada. Esa idempotencia es justamente lo que
 * vuelve seguro este esquema.
 *
 * Se puede desactivar con `EXPIRY_NOTICES_ENABLED=false` (útil en desarrollo,
 * para no mandar correos reales desde la máquina de alguien).
 */
@Injectable()
export class ExpiryNoticesScheduler {
  private readonly logger = new Logger(ExpiryNoticesScheduler.name);

  constructor(private readonly avisos: ExpiryNoticesService) {}

  private get habilitado(): boolean {
    return process.env.EXPIRY_NOTICES_ENABLED !== 'false';
  }

  @Cron('0 8 * * *', { name: 'avisos-vencimiento', timeZone: 'America/Santiago' })
  async correr(): Promise<void> {
    if (!this.habilitado) {
      this.logger.log('Barrido de vencimientos desactivado por configuración.');
      return;
    }
    try {
      await this.avisos.barrer();
    } catch (error) {
      // Nunca dejar que una excepción del barrido tumbe el proceso de la API:
      // los avisos son importantes, pero no al precio de la plataforma entera.
      this.logger.error(`Barrido de vencimientos falló: ${(error as Error).message}`);
    }
  }
}
