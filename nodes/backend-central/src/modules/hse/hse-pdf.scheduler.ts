import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DIAS_RETENCION_PDF, HseService } from './hse.service';

/**
 * Borra del storage los PDF de incidentes que pasaron el mes de retención.
 *
 * Lo que se borra es la COPIA, no el reporte: los datos quedan en la base y el
 * PDF se vuelve a armar idéntico cuando alguien lo pide. Corre de madrugada,
 * hora de Chile, para no competir con el uso del día.
 */
@Injectable()
export class HsePdfScheduler {
  private readonly logger = new Logger(HsePdfScheduler.name);

  constructor(private readonly hse: HseService) {}

  @Cron('0 4 * * *', { name: 'purgar-pdf-incidentes', timeZone: 'America/Santiago' })
  async purgar(): Promise<void> {
    try {
      const borrados = await this.hse.purgarPdfsVencidos();
      if (borrados > 0) {
        this.logger.log(
          `Se borraron ${borrados} PDF con más de ${DIAS_RETENCION_PDF} días. Los reportes siguen en la base.`,
        );
      }
    } catch (error) {
      this.logger.error(`Falló la purga de PDF de incidentes: ${String(error)}`);
    }
  }
}
