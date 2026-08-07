import { Injectable, Logger } from '@nestjs/common';
import {
  CHECKLIST_VEHICULO_GMT,
  SECCIONES_CHECKLIST_VEHICULO,
} from '@gmt-platform/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import { SheetsClientService } from './sheets-client.service';
import {
  indexarCabecera,
  mapearFila,
  type FilaDescartada,
  type RegistroImportado,
} from './sheets-import.util';
import { normalizarPatente } from './sheets-normalize.util';

/** Marca de procedencia de los checklists importados. */
export const ORIGEN_SHEETS = 'SHEETS';

/** Pestaña y rango de la planilla que trae los checklists. */
const RANGO = 'RESPUESTAS!A1:CN20000';

/** Cuántas filas se insertan por sentencia. */
const LOTE = 500;

export interface ResumenImportacion {
  /** `false` cuando falta la credencial o el id de la planilla. */
  configurado: boolean;
  /** Filas con datos leídas de la planilla. */
  leidas: number;
  /** Checklists nuevos guardados en esta pasada. */
  importadas: number;
  /** Ya estaban: la pasada anterior los trajo. Es lo esperado al re-correr. */
  yaExistian: number;
  /** Filas que no se pudieron usar, con su motivo. */
  descartadas: FilaDescartada[];
  /** Patentes con checklists que no existen como vehículo en GMT Link. */
  sinVehiculo: Array<{ patente: string; filas: number }>;
  /**
   * Vehículos creados en esta pasada porque su patente no existía. Hay que
   * mirarlos: alguna puede ser un tipeo de la planilla y no un vehículo real.
   */
  vehiculosCreados: Array<{ patente: string; code: string; filas: number }>;
  /** Vehículos que existen pero no tienen plantilla de checklist. */
  sinPlantilla: Array<{ patente: string; code: string; filas: number }>;
  /** Cuánto tardó, para saber si conviene acotar el rango. */
  duracionMs: number;
}

/**
 * Importa los checklists que la flota sigue llenando en el formulario de
 * AppScript, que descarga a una planilla de cálculo.
 *
 * ── Dirección ──────────────────────────────────────────────────────────────
 *
 * SOLO se lee. GMT Link es el sistema principal y la planilla es la fuente
 * legada mientras dure la transición; nunca se escribe de vuelta (decisión del
 * dueño). Por eso no hay ninguna llamada de escritura acá ni en el cliente.
 *
 * ── Idempotencia ───────────────────────────────────────────────────────────
 *
 * Corre las veces que haga falta sin duplicar: cada checklist guarda el `idForm`
 * de la planilla y hay un índice único sobre (origen, idForm). Se combina con
 * una consulta previa de los ya conocidos para no intentar insertarlos, y con
 * `skipDuplicates` como red por si alguien corre dos importaciones a la vez.
 *
 * ── Vehículos que faltan ───────────────────────────────────────────────────
 *
 * Si la planilla usa una patente que GMT Link no tiene, se CREA el vehículo
 * (decisión del dueño) con su plantilla, marcado en la descripción como creado
 * por la importación. Queda anotado en el resumen porque hay que revisarlo:
 * algunas de esas patentes son casi con seguridad tipeos de la planilla.
 *
 * ── Lo que NO hace ─────────────────────────────────────────────────────────
 *
 * No toca la plantilla de un vehículo que YA existe. Solo crea la del vehículo
 * que la importación acaba de crear, donde no hay trabajo humano que atropellar;
 * en uno existente la plantilla tiene su propio flujo de revisión y no puede
 * cambiar como efecto colateral de una importación.
 *
 * No corrige patentes por parecido. `SIRF88` (2 checklists) se parece mucho a
 * `SKRF88` (471), pero fusionarlas por corazonada sería atribuirle uso a un
 * vehículo real sin evidencia: se crea aparte y una persona decide.
 *
 * No adivina personas. El conductor se guarda como texto informativo y nunca
 * como autoría.
 */
@Injectable()
export class SheetsImportService {
  private readonly logger = new Logger(SheetsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsClientService,
  ) {}

  /**
   * Vehículos de GMT Link indexados por patente NORMALIZADA.
   *
   * Se normaliza en los dos lados: en la planilla la misma patente aparece como
   * `SKRF88`, `SK RF 88` y `SKRF-88`, y nada garantiza que la cargada en GMT
   * Link esté escrita igual.
   */
  private async vehiculosPorPatente(): Promise<
    Map<string, { id: string; code: string; templateId: string | null }>
  > {
    const activos = await this.prisma.asset.findMany({
      where: { type: 'VEHICULO' },
      select: {
        id: true,
        code: true,
        identifier: true,
        checklistTemplate: { select: { id: true } },
      },
    });

    const mapa = new Map<string, { id: string; code: string; templateId: string | null }>();
    for (const a of activos) {
      const patente = normalizarPatente(a.identifier);
      if (!patente) continue;
      mapa.set(patente, {
        id: a.id,
        code: a.code,
        templateId: a.checklistTemplate?.id ?? null,
      });
    }
    return mapa;
  }

  /**
   * Descarta los `idForm` repetidos DENTRO de la misma planilla, quedándose con
   * el primero.
   *
   * La planilla real trae 11 repetidos. Sin esto el índice único los rechazaría
   * de a uno y la importación fallaría a mitad de camino, en vez de resolver algo
   * que es un problema conocido del origen.
   */
  private quitarRepetidos(registros: RegistroImportado[]): {
    unicos: RegistroImportado[];
    repetidos: FilaDescartada[];
  } {
    const vistos = new Set<string>();
    const unicos: RegistroImportado[] = [];
    const repetidos: FilaDescartada[] = [];

    for (const r of registros) {
      if (vistos.has(r.externalId)) {
        repetidos.push({
          fila: 0,
          externalId: r.externalId,
          motivo: 'idForm repetido dentro de la planilla; se conserva la primera aparición.',
        });
        continue;
      }
      vistos.add(r.externalId);
      unicos.push(r);
    }
    return { unicos, repetidos };
  }

  /** Siguiente código libre de la serie GMT-VH-XXXX. */
  private async siguienteCodigo(): Promise<string> {
    const ultimo = await this.prisma.asset.findFirst({
      where: { type: 'VEHICULO', code: { startsWith: 'GMT-VH-' } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const n = ultimo ? Number(ultimo.code.replace('GMT-VH-', '')) : 0;
    return `GMT-VH-${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, '0')}`;
  }

  /**
   * Crea los vehículos de las patentes que la planilla usa y GMT Link no tiene
   * (decisión del dueño: que entren igual y después se ordena).
   *
   * Se les crea también la plantilla de checklist, porque sin ella sus registros
   * no tendrían de qué colgar y la creación del vehículo no habría servido de
   * nada. Es la ÚNICA vez que la importación crea una plantilla: en un vehículo
   * recién creado no hay trabajo humano que atropellar, a diferencia de uno
   * existente, donde la plantilla tiene su propio flujo de revisión.
   *
   * Quedan marcados en la descripción como creados por la importación. Importa
   * porque algunas de estas patentes son casi con seguridad tipeos (`SIRF88`
   * tiene 2 checklists y `SKRF88` tiene 471): hay que poder reconocerlos después
   * para fusionarlos o darlos de baja.
   */
  private async crearVehiculosFaltantes(
    registros: RegistroImportado[],
    vehiculos: Map<string, { id: string; code: string; templateId: string | null }>,
  ): Promise<Array<{ patente: string; code: string; filas: number }>> {
    const faltantes = new Map<string, number>();
    for (const r of registros) {
      if (!vehiculos.has(r.patente)) {
        faltantes.set(r.patente, (faltantes.get(r.patente) ?? 0) + 1);
      }
    }

    const creados: Array<{ patente: string; code: string; filas: number }> = [];
    for (const [patente, filas] of faltantes) {
      const code = await this.siguienteCodigo();
      const asset = await this.prisma.asset.create({
        data: {
          code,
          type: 'VEHICULO',
          name: `Vehículo ${patente}`,
          description:
            'Creado automáticamente al importar los checklists de la planilla: la patente ' +
            'aparecía en los registros y no existía en GMT Link. Revisa si corresponde a un ' +
            'vehículo real o a un error de tipeo en la planilla.',
          identifier: patente,
          identifierType: 'PATENTE',
          status: 'NO_DISPONIBLE',
          checklistTemplate: {
            create: {
              name: 'Checklist camioneta liviana',
              items: CHECKLIST_VEHICULO_GMT as unknown as object,
              sections: SECCIONES_CHECKLIST_VEHICULO as unknown as object,
              // APROBADO igual que las 17 plantillas ya desplegadas: es la misma
              // definición, no una propuesta que alguien deba revisar.
              status: 'APROBADO',
            },
          },
        },
        select: { id: true, code: true, checklistTemplate: { select: { id: true } } },
      });

      vehiculos.set(patente, {
        id: asset.id,
        code: asset.code,
        templateId: asset.checklistTemplate?.id ?? null,
      });
      creados.push({ patente, code: asset.code, filas });
      this.logger.log(`Vehículo creado por la importación: ${asset.code} (${patente}).`);
    }
    return creados;
  }

  /** Corre la importación completa. */
  async importar(): Promise<ResumenImportacion> {
    const inicio = Date.now();
    const vacio: ResumenImportacion = {
      configurado: false,
      leidas: 0,
      importadas: 0,
      yaExistian: 0,
      descartadas: [],
      sinVehiculo: [],
      vehiculosCreados: [],
      sinPlantilla: [],
      duracionMs: 0,
    };

    if (!this.sheets.estaConfigurado()) {
      this.logger.warn(
        'Importación de checklists omitida: falta GOOGLE_SHEETS_CREDENTIALS o GOOGLE_SHEETS_CHECKLIST_ID.',
      );
      return vacio;
    }

    const filas = await this.sheets.leerRango(RANGO);
    const cabecera = filas[0];
    if (!cabecera) {
      this.logger.warn('La planilla no devolvió ninguna fila.');
      return { ...vacio, configurado: true, duracionMs: Date.now() - inicio };
    }
    const col = indexarCabecera(cabecera);

    // 1. Traducir cada fila.
    const registros: RegistroImportado[] = [];
    const descartadas: FilaDescartada[] = [];
    let leidas = 0;
    for (let i = 1; i < filas.length; i += 1) {
      const fila = filas[i]!;
      if (fila.every((v) => v === '')) continue;
      leidas += 1;
      const res = mapearFila(fila, col, i + 1);
      if ('descarte' in res) descartadas.push(res.descarte);
      else registros.push(res.registro);
    }

    // 2. Repetidos del propio origen.
    const { unicos, repetidos } = this.quitarRepetidos(registros);
    descartadas.push(...repetidos);

    // 3. Resolver el vehículo de cada uno, creando el que falte.
    const vehiculos = await this.vehiculosPorPatente();
    const creados = await this.crearVehiculosFaltantes(unicos, vehiculos);
    const sinVehiculo = new Map<string, number>();
    const sinPlantilla = new Map<string, { code: string; filas: number }>();
    const listos: Array<{ registro: RegistroImportado; assetId: string; templateId: string }> = [];

    for (const r of unicos) {
      const v = vehiculos.get(r.patente);
      if (!v) {
        sinVehiculo.set(r.patente, (sinVehiculo.get(r.patente) ?? 0) + 1);
        continue;
      }
      if (!v.templateId) {
        const previo = sinPlantilla.get(r.patente);
        sinPlantilla.set(r.patente, { code: v.code, filas: (previo?.filas ?? 0) + 1 });
        continue;
      }
      listos.push({ registro: r, assetId: v.id, templateId: v.templateId });
    }

    // 4. Saltar los que ya se importaron antes. Se consulta una sola vez en vez
    //    de dejar que el índice los rechace: así `importadas` cuenta lo que de
    //    verdad entró y no se pierde entre errores esperados.
    const yaConocidos = new Set(
      (
        await this.prisma.checklistSubmission.findMany({
          where: {
            externalSource: ORIGEN_SHEETS,
            externalId: { in: listos.map((l) => l.registro.externalId) },
          },
          select: { externalId: true },
        })
      ).map((s) => s.externalId!),
    );
    const nuevos = listos.filter((l) => !yaConocidos.has(l.registro.externalId));

    // 5. Insertar por lotes.
    let importadas = 0;
    for (let i = 0; i < nuevos.length; i += LOTE) {
      const lote = nuevos.slice(i, i + LOTE);
      const res = await this.prisma.checklistSubmission.createMany({
        data: lote.map((l) => ({
          assetId: l.assetId,
          templateId: l.templateId,
          // Sin usuario: el checklist no se hizo en la plataforma.
          userId: null,
          answers: l.registro.answers as unknown as object,
          // La fecha REAL del checklist. Si se dejara el valor por defecto, los
          // 2.000 registros históricos aterrizarían todos hoy y el gráfico de
          // uso quedaría inservible.
          createdAt: l.registro.fecha,
          externalSource: ORIGEN_SHEETS,
          externalId: l.registro.externalId,
          externalAuthor: l.registro.conductor,
        })),
        // Red por si dos importaciones corren a la vez: la consulta del paso 4
        // ya filtró lo conocido, pero entre esa consulta y este insert puede
        // haber entrado otra pasada.
        skipDuplicates: true,
      });
      importadas += res.count;
    }

    const resumen: ResumenImportacion = {
      configurado: true,
      leidas,
      importadas,
      yaExistian: listos.length - importadas,
      descartadas,
      sinVehiculo: [...sinVehiculo].map(([patente, filas]) => ({ patente, filas })),
      vehiculosCreados: creados,
      sinPlantilla: [...sinPlantilla].map(([patente, v]) => ({
        patente,
        code: v.code,
        filas: v.filas,
      })),
      duracionMs: Date.now() - inicio,
    };

    this.logger.log(
      `Importación de checklists: ${resumen.importadas} nuevos, ${resumen.yaExistian} ya estaban, ` +
        `${resumen.descartadas.length} descartados, ${resumen.vehiculosCreados.length} vehículos creados ` +
        `(${resumen.duracionMs} ms).`,
    );
    return resumen;
  }
}
