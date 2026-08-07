import { Injectable } from '@nestjs/common';
import type { UsoGranularidad, UsoVehiculoView } from '@gmt-platform/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import { AssetsService } from './assets.service';
import {
  ITEM_ODOMETRO,
  INTERVALO_MANTENCION_KM,
  kmPorPeriodo,
  limpiarSerie,
  promedios,
  proyectarMantencion,
  type LecturaOdometro,
} from './vehicle-usage.util';

/** Filtros del gráfico de uso. */
export interface FiltroUso {
  granularidad?: UsoGranularidad;
  /** Inicio del rango (inclusive). */
  desde?: Date;
  /** Fin del rango (inclusive). */
  hasta?: Date;
  /** Odómetro de la última mantención, si se conoce. */
  ultimaMantencionKm?: number;
}

/** Una respuesta de checklist tal como se guarda en el JSON. */
interface RespuestaChecklist {
  itemId?: unknown;
  value?: unknown;
}

/**
 * Uso de un vehículo a partir del odómetro de sus checklists.
 *
 * Se apoya en `vehicle-usage.util` (puro) para toda la aritmética; acá vive solo
 * la lectura de datos, el gate de autorización y el armado de la respuesta.
 *
 * El odómetro no tiene columna propia: viaja dentro del JSON de respuestas del
 * checklist, identificado por el ítem `kilometraje`. Se verificó contra
 * producción que ese id es estable en todas las plantillas de vehículo y que el
 * 99% de los checklists lo trae con valor numérico.
 */
@Injectable()
export class VehicleUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
  ) {}

  /** Extrae el odómetro del JSON de respuestas. `null` si no viene o no es número. */
  private odometroDe(answers: unknown): number | null {
    if (!Array.isArray(answers)) return null;
    for (const cruda of answers as RespuestaChecklist[]) {
      if (cruda && typeof cruda === 'object' && cruda.itemId === ITEM_ODOMETRO) {
        // `value` llega como string desde el formulario; `Number('')` da 0, que
        // sería una lectura falsa de odómetro en cero, así que se descarta antes.
        if (cruda.value === null || cruda.value === undefined || cruda.value === '') {
          return null;
        }
        const n = Number(cruda.value);
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  }

  /**
   * Serie de odómetro del vehículo, ya ordenada por fecha.
   *
   * El filtro por fecha se aplica en la CONSULTA y no después: con cientos de
   * checklists por vehículo, traerlos todos para descartar la mayoría en memoria
   * sería trabajo tirado en cada carga de la pantalla.
   */
  private async lecturasDe(assetId: string, filtro: FiltroUso): Promise<LecturaOdometro[]> {
    const rango: { gte?: Date; lte?: Date } = {};
    if (filtro.desde) rango.gte = filtro.desde;
    if (filtro.hasta) rango.lte = filtro.hasta;

    const submissions = await this.prisma.checklistSubmission.findMany({
      where: {
        assetId,
        ...(filtro.desde || filtro.hasta ? { createdAt: rango } : {}),
      },
      select: {
        createdAt: true,
        answers: true,
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const lecturas: LecturaOdometro[] = [];
    for (const s of submissions) {
      const km = this.odometroDe(s.answers);
      if (km === null) continue;
      const conductor = s.user ? `${s.user.firstName} ${s.user.lastName}`.trim() : '';
      lecturas.push({
        fecha: s.createdAt,
        km,
        ...(conductor ? { conductor } : {}),
      });
    }
    return lecturas;
  }

  /**
   * Uso, promedios y proyección de mantención de un vehículo.
   *
   * El gate es el MISMO que el resto del detalle del activo
   * (`assertCanManageAssetById`, que ya incluye al admin de flota): la serie de
   * odómetro dice quién manejó qué y cuándo, así que no puede ser más abierta
   * que la ficha que la contiene. Se llama acá y no en el controlador para que
   * no exista una forma de pedir estos datos sin pasar por la autorización.
   */
  async uso(assetId: string, userId: string, filtro: FiltroUso = {}): Promise<UsoVehiculoView> {
    // Lanza 404 si el activo no existe y 403 si el usuario no lo gestiona.
    await this.assets.assertCanManageAssetById(assetId, userId);

    const granularidad: UsoGranularidad = filtro.granularidad ?? 'semana';
    const crudas = await this.lecturasDe(assetId, filtro);
    const { lecturas, descartadas } = limpiarSerie(crudas);

    const prom = promedios(lecturas);
    const proy = proyectarMantencion(lecturas, {
      ...(filtro.ultimaMantencionKm !== undefined
        ? { ultimaMantencionKm: filtro.ultimaMantencionKm }
        : {}),
    });

    return {
      granularidad,
      serie: kmPorPeriodo(lecturas, granularidad),
      promedios: prom,
      proyeccion: proy
        ? {
            kmObjetivo: proy.kmObjetivo,
            kmRestantes: proy.kmRestantes,
            diasEstimados: proy.diasEstimados,
            fechaEstimada: proy.fechaEstimada.toISOString(),
            kmActual: proy.kmActual,
            fechaUltimaLectura: lecturas[lecturas.length - 1]!.fecha.toISOString(),
            intervaloKm: INTERVALO_MANTENCION_KM,
            baseEstimada: filtro.ultimaMantencionKm === undefined,
          }
        : null,
      descartadas: descartadas.map((d) => ({
        fecha: d.fecha.toISOString(),
        km: d.km,
        motivo: d.motivo,
        conductor: d.conductor ?? null,
      })),
      checklistsConsiderados: crudas.length,
    };
  }
}
