import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SheetsImportService } from './sheets-import.service';

/**
 * Trae una vez al día los checklists que la flota siguió llenando en la planilla.
 *
 * A las 05:00 de Chile continental: los checklists se hacen al empezar la
 * jornada, así que a esa hora ya está todo lo del día anterior y la pantalla
 * amanece al día. Se separa de las 08:00 del barrido de vencimientos para no
 * apilar las dos tareas pesadas en el mismo minuto.
 *
 * Corre DENTRO del proceso de la API, igual que el barrido de vencimientos: el
 * servicio está siempre levantado y el plan de Railway no ofrece tareas
 * programadas propias. Que sea seguro depende por completo de la idempotencia
 * de la importación: si corriera dos veces, o en dos instancias a la vez, no
 * duplica nada.
 *
 * Se puede desactivar con `SHEETS_IMPORT_ENABLED=false`. Sin credencial
 * configurada el servicio ya se salta solo, así que en una máquina de desarrollo
 * no hace nada aunque quede encendido.
 */
@Injectable()
export class SheetsImportScheduler {
  private readonly logger = new Logger(SheetsImportScheduler.name);

  constructor(private readonly importador: SheetsImportService) {}

  private get habilitado(): boolean {
    return process.env.SHEETS_IMPORT_ENABLED !== 'false';
  }

  @Cron('0 5 * * *', { name: 'importar-checklists', timeZone: 'America/Santiago' })
  async correr(): Promise<void> {
    if (!this.habilitado) {
      this.logger.log('Importación de checklists desactivada por configuración.');
      return;
    }
    try {
      const r = await this.importador.importar();
      if (!r.configurado) return;

      // Lo que necesita atención se registra aparte del conteo: si queda dentro
      // de la línea de resumen, nadie lo lee.
      if (r.vehiculosCreados.length > 0) {
        this.logger.warn(
          `La importación creó ${r.vehiculosCreados.length} vehículo(s) por patentes desconocidas: ` +
            r.vehiculosCreados.map((v) => `${v.code} (${v.patente}, ${v.filas})`).join(', ') +
            '. Revisa si son reales o tipeos de la planilla.',
        );
      }
      if (r.descartadas.length > 0) {
        this.logger.warn(`La importación descartó ${r.descartadas.length} fila(s).`);
      }
    } catch (error) {
      // Nunca dejar que un fallo de la importación tumbe el proceso de la API.
      // La planilla es una fuente externa: puede estar caída, sin permiso o
      // reestructurada, y nada de eso puede llevarse la plataforma por delante.
      this.logger.error(`Importación de checklists falló: ${(error as Error).message}`);
    }
  }
}
