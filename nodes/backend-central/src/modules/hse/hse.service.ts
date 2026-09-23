import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { HseIncident, HseIncidentPhoto, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { resolveFreshFileUrl } from '../../common/storage/fresh-file-url.util';
import { tablePage, tableSkipTake } from '../../common/table-pagination.util';
import type {
  HseIncidentCreated,
  HseIncidentDetail,
  HseIncidentRow,
  TablePage,
  TableRequest,
} from '@gmt-platform/contracts';
import { buildIncidentePdf, type DatosIncidente, type FotoIncidente } from './incidente-pdf.util';
import type { CreateIncidentDto } from './dto/hse.dto';

/**
 * HSE — reportes de incidente.
 *
 * El registro de la base es la FUENTE: el PDF es una copia que se puede volver a
 * armar en cualquier momento con los mismos datos. Por eso el archivo se guarda
 * solo un mes (lo que dura el trámite) y después se borra; si alguien lo pide
 * más tarde, se genera al vuelo. Los datos no se borran nunca.
 */

/** Carpeta del storage donde viven las fotos y los PDF de HSE. */
const CARPETA_FOTOS = 'hse/incidentes/fotos';
const CARPETA_PDF = 'hse/incidentes/pdf';

/** Prefijo del correlativo del formato. Arranca en 10: del 01 al 09 son papel. */
const PREFIJO_CODIGO = 'GMT-SG-RG-';
const PRIMER_CORRELATIVO = 10;

/** Días que se conserva el PDF antes de borrarlo del storage. */
export const DIAS_RETENCION_PDF = 30;

/** Imágenes que pdf-lib puede incrustar en el formato. */
const MIME_FOTOS: ReadonlyMap<string, 'jpg' | 'png'> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
]);

export const MAX_FOTO_BYTES = 8 * 1024 * 1024;
export const MAX_FOTOS = 3;

/** Una foto recibida del formulario, ya validada. */
export interface FotoSubida {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

type IncidenteConFotos = HseIncident & { photos: HseIncidentPhoto[] };

@Injectable()
export class HseService {
  private readonly logger = new Logger(HseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ── Alta desde el formulario público ──────────────────────────────────────

  /**
   * Valida las fotos del formulario. La primera es obligatoria porque es la que
   * va en el recuadro "Imagen / Esquema / Plano" del formato, y solo se aceptan
   * JPG y PNG: son los formatos que se pueden incrustar en el PDF.
   */
  validarFotos(fotos: FotoSubida[] | undefined): FotoSubida[] {
    const lista = fotos ?? [];
    if (lista.length === 0) {
      throw new BadRequestException('Adjunta al menos una foto del incidente.');
    }
    if (lista.length > MAX_FOTOS) {
      throw new BadRequestException(`Puedes adjuntar hasta ${MAX_FOTOS} fotos.`);
    }
    for (const foto of lista) {
      if (!MIME_FOTOS.has(foto.mimetype)) {
        throw new BadRequestException('Las fotos deben ser JPG o PNG.');
      }
      if (foto.buffer.length > MAX_FOTO_BYTES) {
        throw new BadRequestException('Cada foto debe pesar menos de 8 MB.');
      }
    }
    return lista;
  }

  async create(dto: CreateIncidentDto, fotos: FotoSubida[]): Promise<HseIncidentCreated> {
    const guardadas = await Promise.all(
      fotos.map((foto) =>
        this.storage.save({
          buffer: foto.buffer,
          filename: foto.originalname,
          contentType: foto.mimetype,
          folder: CARPETA_FOTOS,
        }),
      ),
    );

    const incidente = await this.crearConCorrelativo(dto, guardadas.map((g) => g.key));

    // El PDF se arma al enviar para que quien reporta se lo lleve al instante.
    // Si fallara, el reporte igual queda guardado: la copia se puede regenerar.
    try {
      await this.generarYGuardarPdf(incidente.id);
    } catch (error) {
      this.logger.error(
        `No se pudo generar el PDF de ${incidente.code} al crearlo: ${String(error)}`,
      );
    }

    return { id: incidente.id, code: incidente.code, publicToken: incidente.publicToken };
  }

  /**
   * Inserta el reporte tomando el siguiente correlativo libre.
   *
   * Dos personas enviando a la vez pueden pedir el mismo número: la unicidad de
   * `code` en la base es la que decide y acá se reintenta con el siguiente. Sin
   * esto, el segundo reporte se perdería con un error que nadie entiende.
   */
  private async crearConCorrelativo(
    dto: CreateIncidentDto,
    fileKeys: string[],
  ): Promise<IncidenteConFotos> {
    const base = this.datosDe(dto, fileKeys);
    for (let intento = 0; intento < 5; intento += 1) {
      const code = await this.siguienteCodigo();
      try {
        return await this.prisma.hseIncident.create({
          data: { ...base, code },
          include: { photos: true },
        });
      } catch (error) {
        if (!esCodigoDuplicado(error)) throw error;
        this.logger.warn(`El código ${code} ya estaba tomado; se reintenta con el siguiente.`);
      }
    }
    throw new BadRequestException(
      'No se pudo asignar el número de registro. Vuelve a intentarlo en un momento.',
    );
  }

  private datosDe(
    dto: CreateIncidentDto,
    fileKeys: string[],
  ): Omit<Prisma.HseIncidentCreateInput, 'code'> {
    return {
      empresa: dto.empresa?.trim() || 'GMT Ingenieria SPA',
      sitio: dto.sitio?.trim() || null,
      area: dto.area?.trim() || null,
      turno: dto.turno?.trim() || null,
      occurredOn: new Date(`${dto.fecha.slice(0, 10)}T00:00:00.000Z`),
      occurredAt: dto.hora,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      lesionPersonas: dto.lesionPersonas ?? false,
      cargoLesionado: dto.cargoLesionado?.trim() || null,
      danoInfraestructura: dto.danoInfraestructura ?? false,
      danoDetalle: dto.danoDetalle?.trim() || null,
      fugaDerrame: dto.fugaDerrame ?? false,
      fugaSustancia: dto.fugaSustancia?.trim() || null,
      fugaDuracionMin: dto.fugaDuracionMin ?? null,
      fugaVolumenM3: dto.fugaVolumenM3 ?? null,
      fugaPh: dto.fugaPh ?? null,
      fugaSuperficieM2: dto.fugaSuperficieM2 ?? null,
      emisionesAire: dto.emisionesAire ?? false,
      emisionGases: dto.emisionGases?.trim() || null,
      emisionDuracionMin: dto.emisionDuracionMin ?? null,
      instalaciones: dto.instalaciones ?? false,
      instalacionesLugar: dto.instalacionesLugar?.trim() || null,
      cuasiAccidente: dto.cuasiAccidente ?? false,
      procesoAfectado: dto.procesoAfectado ?? false,
      tiempoPerdido: dto.tiempoPerdido ?? null,
      descripcion: dto.descripcion.trim(),
      accionesInmediatas: dto.accionesInmediatas.trim(),
      preparaNombre: dto.preparaNombre.trim(),
      preparaCargo: dto.preparaCargo?.trim() || null,
      preparedOn: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'),
      reporterEmail: dto.reporterEmail?.trim() || null,
      photos: {
        create: fileKeys.map((fileKey, position) => ({ fileKey, position })),
      },
    };
  }

  /** Siguiente número libre de la serie GMT-SG-RG-NN. */
  private async siguienteCodigo(): Promise<string> {
    const filas = await this.prisma.hseIncident.findMany({
      where: { code: { startsWith: PREFIJO_CODIGO } },
      select: { code: true },
    });
    const ultimo = filas.reduce((max, f) => {
      const m = new RegExp(`^${PREFIJO_CODIGO}(\\d+)$`).exec(f.code);
      return m ? Math.max(max, Number(m[1])) : max;
    }, PRIMER_CORRELATIVO - 1);
    return `${PREFIJO_CODIGO}${String(ultimo + 1).padStart(2, '0')}`;
  }

  // ── PDF ───────────────────────────────────────────────────────────────────

  /** Arma el PDF del reporte. No toca la base: solo lee y devuelve los bytes. */
  async pdfDe(incidente: IncidenteConFotos): Promise<Buffer> {
    const primera = [...incidente.photos].sort((a, b) => a.position - b.position)[0];
    let foto: FotoIncidente | null = null;
    if (primera) {
      try {
        const bytes = await this.storage.read(primera.fileKey);
        foto = { bytes, kind: primera.fileKey.toLowerCase().endsWith('.png') ? 'png' : 'jpg' };
      } catch (error) {
        // Una foto ilegible no puede impedir emitir el reporte: el resto del
        // formato es el documento, la imagen es el respaldo.
        this.logger.warn(`Foto ilegible en ${incidente.code}: ${String(error)}`);
      }
    }
    return buildIncidentePdf(this.aFormato(incidente, foto));
  }

  private aFormato(incidente: IncidenteConFotos, foto: FotoIncidente | null): DatosIncidente {
    return {
      code: incidente.code,
      empresa: incidente.empresa,
      sitio: incidente.sitio,
      area: incidente.area,
      turno: incidente.turno,
      fecha: fechaCl(incidente.occurredOn),
      hora: incidente.occurredAt,
      lesionPersonas: incidente.lesionPersonas,
      cargoLesionado: incidente.cargoLesionado,
      danoInfraestructura: incidente.danoInfraestructura,
      danoDetalle: incidente.danoDetalle,
      fugaDerrame: incidente.fugaDerrame,
      fugaSustancia: incidente.fugaSustancia,
      fugaDuracionMin: incidente.fugaDuracionMin,
      fugaVolumenM3: incidente.fugaVolumenM3,
      fugaPh: incidente.fugaPh,
      fugaSuperficieM2: incidente.fugaSuperficieM2,
      emisionesAire: incidente.emisionesAire,
      emisionGases: incidente.emisionGases,
      emisionDuracionMin: incidente.emisionDuracionMin,
      instalaciones: incidente.instalaciones,
      instalacionesLugar: incidente.instalacionesLugar,
      cuasiAccidente: incidente.cuasiAccidente,
      procesoAfectado: incidente.procesoAfectado,
      tiempoPerdido: incidente.tiempoPerdido === 'CON' || incidente.tiempoPerdido === 'SIN'
        ? incidente.tiempoPerdido
        : null,
      descripcion: incidente.descripcion,
      accionesInmediatas: incidente.accionesInmediatas,
      preparaNombre: incidente.preparaNombre,
      preparaCargo: incidente.preparaCargo,
      preparaFecha: fechaCl(incidente.preparedOn),
      foto,
    };
  }

  /** Genera el PDF y lo deja en el storage (la copia que dura un mes). */
  private async generarYGuardarPdf(id: string): Promise<Buffer> {
    const incidente = await this.buscar({ id });
    const bytes = await this.pdfDe(incidente);
    const guardado = await this.storage.save({
      buffer: bytes,
      filename: `${incidente.code}.pdf`,
      contentType: 'application/pdf',
      folder: CARPETA_PDF,
    });
    await this.prisma.hseIncident.update({
      where: { id },
      data: { pdfKey: guardado.key, pdfGeneratedAt: new Date() },
    });
    return bytes;
  }

  /**
   * El PDF del reporte: el guardado si todavía existe, o uno recién armado con
   * los mismos datos. Quien lo recibe no nota la diferencia.
   */
  async pdf(where: Prisma.HseIncidentWhereUniqueInput): Promise<{ bytes: Buffer; code: string }> {
    const incidente = await this.buscar(where);
    if (incidente.pdfKey) {
      try {
        return { bytes: await this.storage.read(incidente.pdfKey), code: incidente.code };
      } catch {
        // El archivo ya no está (purgado o movido): se regenera sin ruido.
      }
    }
    return { bytes: await this.pdfDe(incidente), code: incidente.code };
  }

  /**
   * Borra del storage los PDF de más de `DIAS_RETENCION_PDF` días. Los datos
   * quedan: lo único que desaparece es la copia, que se puede rehacer.
   */
  async purgarPdfsVencidos(hoy = new Date()): Promise<number> {
    const limite = new Date(hoy.getTime() - DIAS_RETENCION_PDF * 24 * 60 * 60 * 1000);
    const vencidos = await this.prisma.hseIncident.findMany({
      where: { pdfKey: { not: null }, pdfGeneratedAt: { lt: limite } },
      select: { id: true, code: true, pdfKey: true },
    });
    let borrados = 0;
    for (const v of vencidos) {
      try {
        if (v.pdfKey) await this.storage.delete(v.pdfKey);
      } catch (error) {
        this.logger.warn(`No se pudo borrar el PDF de ${v.code}: ${String(error)}`);
      }
      await this.prisma.hseIncident.update({
        where: { id: v.id },
        data: { pdfKey: null, pdfGeneratedAt: null },
      });
      borrados += 1;
    }
    if (borrados > 0) this.logger.log(`PDF de incidentes purgados: ${borrados}.`);
    return borrados;
  }

  // ── Consulta desde la sección HSE ─────────────────────────────────────────

  async table(req: TableRequest): Promise<TablePage<HseIncidentRow>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);
    const busqueda = req.search?.trim();
    const where: Prisma.HseIncidentWhereInput = busqueda
      ? {
          OR: [
            { code: { contains: busqueda, mode: 'insensitive' } },
            { descripcion: { contains: busqueda, mode: 'insensitive' } },
            { sitio: { contains: busqueda, mode: 'insensitive' } },
            { area: { contains: busqueda, mode: 'insensitive' } },
            { preparaNombre: { contains: busqueda, mode: 'insensitive' } },
          ],
        }
      : {};

    const orden: Record<string, Prisma.HseIncidentOrderByWithRelationInput[]> = {
      codigo: [{ code: req.sortDir === 'asc' ? 'asc' : 'desc' }],
      fecha: [{ occurredOn: req.sortDir === 'asc' ? 'asc' : 'desc' }, { occurredAt: 'desc' }],
      lugar: [{ sitio: req.sortDir === 'asc' ? 'asc' : 'desc' }],
      prepara: [{ preparaNombre: req.sortDir === 'asc' ? 'asc' : 'desc' }],
    };

    const [filas, total] = await Promise.all([
      this.prisma.hseIncident.findMany({
        where,
        orderBy: orden[req.sortBy ?? ''] ?? [{ occurredOn: 'desc' }, { code: 'desc' }],
        skip,
        take,
        include: { photos: { select: { id: true } } },
      }),
      this.prisma.hseIncident.count({ where }),
    ]);

    const items: HseIncidentRow[] = filas.map((f) => ({
      id: f.id,
      code: f.code,
      occurredOn: f.occurredOn.toISOString().slice(0, 10),
      occurredAt: f.occurredAt,
      sitio: f.sitio,
      area: f.area,
      consecuencias: consecuenciasDe(f),
      resumen: resumir(f.descripcion),
      preparaNombre: f.preparaNombre,
      fotos: f.photos.length,
      createdAt: f.createdAt.toISOString(),
    }));
    return tablePage(items, total, page, pageSize);
  }

  async detail(id: string): Promise<HseIncidentDetail> {
    const f = await this.buscar({ id });
    const fotos = await Promise.all(
      [...f.photos]
        .sort((a, b) => a.position - b.position)
        .map((p) => resolveFreshFileUrl(this.storage, p.fileKey)),
    );
    return {
      id: f.id,
      code: f.code,
      empresa: f.empresa,
      sitio: f.sitio,
      area: f.area,
      turno: f.turno,
      occurredOn: f.occurredOn.toISOString().slice(0, 10),
      occurredAt: f.occurredAt,
      latitude: f.latitude,
      longitude: f.longitude,
      lesionPersonas: f.lesionPersonas,
      cargoLesionado: f.cargoLesionado,
      danoInfraestructura: f.danoInfraestructura,
      danoDetalle: f.danoDetalle,
      fugaDerrame: f.fugaDerrame,
      fugaSustancia: f.fugaSustancia,
      fugaDuracionMin: f.fugaDuracionMin,
      fugaVolumenM3: f.fugaVolumenM3,
      fugaPh: f.fugaPh,
      fugaSuperficieM2: f.fugaSuperficieM2,
      emisionesAire: f.emisionesAire,
      emisionGases: f.emisionGases,
      emisionDuracionMin: f.emisionDuracionMin,
      instalaciones: f.instalaciones,
      instalacionesLugar: f.instalacionesLugar,
      cuasiAccidente: f.cuasiAccidente,
      procesoAfectado: f.procesoAfectado,
      tiempoPerdido: f.tiempoPerdido === 'CON' || f.tiempoPerdido === 'SIN' ? f.tiempoPerdido : null,
      descripcion: f.descripcion,
      accionesInmediatas: f.accionesInmediatas,
      preparaNombre: f.preparaNombre,
      preparaCargo: f.preparaCargo,
      preparedOn: f.preparedOn.toISOString().slice(0, 10),
      reporterEmail: f.reporterEmail,
      fotos,
      createdAt: f.createdAt.toISOString(),
    };
  }

  private async buscar(where: Prisma.HseIncidentWhereUniqueInput): Promise<IncidenteConFotos> {
    const incidente = await this.prisma.hseIncident.findUnique({ where, include: { photos: true } });
    if (!incidente) throw new NotFoundException('El reporte de incidente no existe.');
    return incidente;
  }
}

/** Fecha date-only a d/m/aaaa, como la escribe el formato impreso. */
function fechaCl(fecha: Date): string {
  return `${fecha.getUTCDate()}/${fecha.getUTCMonth() + 1}/${fecha.getUTCFullYear()}`;
}

/** Las consecuencias marcadas, ya legibles para el listado. */
function consecuenciasDe(f: HseIncident): string[] {
  const marcadas: string[] = [];
  if (f.lesionPersonas) marcadas.push('Lesión a personas');
  if (f.danoInfraestructura) marcadas.push('Daño a infraestructura / equipo');
  if (f.fugaDerrame) marcadas.push('Fuga / derrame');
  if (f.emisionesAire) marcadas.push('Emisiones al aire');
  if (f.instalaciones) marcadas.push('Instalaciones (robos, hurtos)');
  if (f.cuasiAccidente) marcadas.push('Cuasi accidente');
  if (f.procesoAfectado) marcadas.push('Proceso o área afectado');
  return marcadas;
}

/** Primeras palabras de la descripción, para leer la fila de un vistazo. */
function resumir(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length <= 110 ? limpio : `${limpio.slice(0, 107)}...`;
}

/** ¿El error de Prisma es la unicidad de `code`? */
function esCodigoDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
