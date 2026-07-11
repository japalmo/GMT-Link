import { Injectable, NotFoundException, UnauthorizedException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email.service';
import { OtpService, OTP_PURPOSES } from '../../common/otp.service';
import { FgaService } from '../../fga/fga.service';
import { sanitizeFilename } from '../../common/storage/local-storage.service';
import { StorageService } from '../../common/storage/storage.service';
import { R2StorageService } from '../../common/storage/r2-storage.service';
import {
  CreateElementDto,
  CreatePhaseDto,
  SaveDataPointDto,
  SaveCubicacionDto,
  SaveReservorioMetadataDto,
  SetPhaseDataSpecDto,
} from './dto/metrics.dto';
import { randomUUID } from 'crypto';

/** Bolsa JSON dinámica validada solo como "objeto" → cruce explícito al tipo Json de Prisma. */
function toInputJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly tokens = new Map<string, string>(); // token -> filename

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly fga: FgaService,
    private readonly storage: StorageService,
    private readonly otp: OtpService,
  ) {}

  /**
   * ¿El backend de almacenamiento activo es Cloudflare R2 (durable)? Cuando lo es,
   * el flujo de DEMs entrega URLs firmadas de R2 (PUT/GET) en vez del mecanismo de
   * token+disco local. El narrowing por `instanceof` da acceso tipado a los métodos
   * específicos de R2.
   */
  private get r2(): R2StorageService | null {
    return this.storage instanceof R2StorageService ? this.storage : null;
  }

  // ── Resolución de projectId para autorización (D3) ──────────────────────────
  // Los endpoints del cliente PyQt no llevan projectId directo; estos resolvers
  // lo derivan desde el código de elemento/servicio/fase que sí traen.

  async getProjectIdForElementCode(code: string): Promise<string> {
    const element = await this.prisma.element.findUnique({
      where: { code },
      select: { projectId: true },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${code} no encontrado.`);
    }
    return element.projectId;
  }

  async getProjectIdForServiceId(serviceId: string): Promise<string> {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: { projectId: true },
    });
    if (!service) {
      throw new NotFoundException(`Servicio con ID ${serviceId} no encontrado.`);
    }
    return service.projectId;
  }

  async getProjectIdForPhaseId(phaseId: string): Promise<string> {
    const phase = await this.prisma.phase.findUnique({
      where: { id: phaseId },
      select: { service: { select: { projectId: true } } },
    });
    if (!phase) {
      throw new NotFoundException(`Fase con ID ${phaseId} no encontrada.`);
    }
    return phase.service.projectId;
  }

  async getProjectIdForDemBlobPath(blobPath: string): Promise<string> {
    const dataPoint = await this.prisma.dataPoint.findFirst({
      where: { fileUrl: blobPath },
      select: { element: { select: { projectId: true } } },
    });
    if (!dataPoint?.element?.projectId) {
      throw new NotFoundException(`No se encontró proyecto para el archivo: ${blobPath}`);
    }
    return dataPoint.element.projectId;
  }

  private async requireProjectPermission(userId: string, projectId: string, relation: string): Promise<void> {
    const allowed = await this.fga.check({
      user: `user:${userId}`,
      relation,
      object: `project:${projectId}`,
    });
    if (!allowed) {
      throw new ForbiddenException(`No tienes el permiso "${relation}" sobre este proyecto.`);
    }
  }

  // ── Elementos ────────────────────────────────────────────────────────────────

  async createPool(dto: CreateElementDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) {
      throw new NotFoundException(`Proyecto con ID ${dto.projectId} no encontrado.`);
    }

    return this.prisma.element.upsert({
      where: { code: dto.code },
      update: {
        name: dto.name,
        type: dto.type,
        locationPolygon: dto.locationPolygon,
        metadata: toInputJson(dto.metadata),
        projectId: dto.projectId,
      },
      create: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        locationPolygon: dto.locationPolygon,
        metadata: toInputJson(dto.metadata),
        projectId: dto.projectId,
      },
    });
  }

  async getPools(projectId: string) {
    return this.prisma.element.findMany({
      where: { projectId },
      orderBy: { code: 'asc' },
    });
  }

  async getPoolById(id: string) {
    const element = await this.prisma.element.findUnique({
      where: { id },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con ID ${id} no encontrado.`);
    }
    return element;
  }

  async updatePool(id: string, dto: CreateElementDto) {
    await this.getPoolById(id);
    return this.prisma.element.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        locationPolygon: dto.locationPolygon,
        metadata: toInputJson(dto.metadata),
      },
    });
  }

  async deletePool(id: string) {
    await this.getPoolById(id);
    await this.prisma.element.delete({
      where: { id },
    });
    return { success: true };
  }

  async getPoolByCode(code: string) {
    const element = await this.prisma.element.findUnique({
      where: { code },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${code} no encontrado.`);
    }
    return element;
  }

  // ── Fases & Variables ────────────────────────────────────────────────────────

  async createPhase(dto: CreatePhaseDto) {
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
    });
    if (!service) {
      throw new NotFoundException(`Servicio con ID ${dto.serviceId} no encontrado.`);
    }

    return this.prisma.phase.create({
      data: {
        code: dto.code,
        name: dto.name,
        serviceId: dto.serviceId,
      },
    });
  }

  async getPhases(serviceId: string) {
    return this.prisma.phase.findMany({
      where: { serviceId },
      include: {
        variables: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getVariables(phaseId: string) {
    return this.prisma.variable.findMany({
      where: { phaseId },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Define el "DataSpec" de una fase: el conjunto de Variables a capturar.
   * Semántica declarativa (PUT): upsert por `code` de las variables enviadas y
   * borrado de las que ya no figuran en el spec. `@@unique([phaseId, code])`
   * hace de clave natural.
   *
   * NOTA: `required` viaja en el DTO por completitud de la API pero NO se
   * persiste — el modelo `Variable` no tiene esa columna (no se toca el schema
   * en esta tarea). TODO: añadir `Variable.required Boolean` en una migración
   * futura para materializarlo.
   */
  async setPhaseDataSpec(phaseId: string, dto: SetPhaseDataSpecDto) {
    const phase = await this.prisma.phase.findUnique({ where: { id: phaseId } });
    if (!phase) {
      throw new NotFoundException(`Fase con ID ${phaseId} no encontrada.`);
    }

    const codes = dto.variables.map((v) => v.code);
    const uniqueCodes = new Set(codes);
    if (uniqueCodes.size !== codes.length) {
      throw new BadRequestException('El DataSpec tiene códigos de variable duplicados.');
    }

    // Guard anti-pérdida de datos: NO eliminar variables que ya tengan
    // DataPoints capturados. Variable→DataPoint es onDelete: Cascade, así que
    // borrarlas destruiría mediciones/cubicaciones reales de forma silenciosa e
    // irrecuperable. Rechazamos la edición en ese caso en vez de destruir datos.
    const toRemove = await this.prisma.variable.findMany({
      where: { phaseId, code: { notIn: codes } },
      select: { code: true, _count: { select: { dataPoints: true } } },
    });
    const withData = toRemove.filter((v) => v._count.dataPoints > 0);
    if (withData.length > 0) {
      throw new BadRequestException(
        `No se pueden eliminar variables con datos ya capturados: ${withData
          .map((v) => v.code)
          .join(', ')}. Consérvalas en el DataSpec o elimina primero sus datos.`,
      );
    }

    await this.prisma.$transaction([
      // Borrar solo variables fuera del spec (ya garantizado: sin DataPoints).
      this.prisma.variable.deleteMany({
        where: { phaseId, code: { notIn: codes } },
      }),
      // Upsert de cada variable del spec.
      ...dto.variables.map((v) =>
        this.prisma.variable.upsert({
          where: { phaseId_code: { phaseId, code: v.code } },
          update: {
            name: v.name,
            type: v.type,
            unit: v.unit ?? null,
            description: v.description ?? null,
            required: v.required ?? false,
          },
          create: {
            phaseId,
            code: v.code,
            name: v.name,
            type: v.type,
            unit: v.unit ?? null,
            description: v.description ?? null,
            required: v.required ?? false,
          },
        }),
      ),
    ]);

    return this.getVariables(phaseId);
  }

  // ── Datos de Medición / Cubicaciones ─────────────────────────────────────────

  async saveDataPoints(userId: string, points: SaveDataPointDto[]) {
    if (points.length === 0) {
      return { success: true, count: 0, points: [] };
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuario no válido.');
    }

    // Pre-fetch all referenced IDs en una sola pasada para evitar N queries
    const variableIds = [...new Set(points.map((p) => p.variableId))];
    const phaseIds = [...new Set(points.map((p) => p.phaseId))];
    const elementIds = [...new Set(points.filter((p) => p.elementId).map((p) => p.elementId!))];

    const [variables, phases, elements] = await Promise.all([
      this.prisma.variable.findMany({ where: { id: { in: variableIds } }, select: { id: true } }),
      this.prisma.phase.findMany({
        where: { id: { in: phaseIds } },
        select: { id: true, service: { select: { projectId: true } } },
      }),
      elementIds.length > 0
        ? this.prisma.element.findMany({ where: { id: { in: elementIds } }, select: { id: true } })
        : Promise.resolve([]),
    ]);

    const variableSet = new Set(variables.map((v) => v.id));
    const phaseSet = new Set(phases.map((p) => p.id));
    const elementSet = new Set(elements.map((e) => e.id));

    // Validar referencias
    for (const point of points) {
      if (!variableSet.has(point.variableId)) {
        throw new NotFoundException(`Variable ${point.variableId} no encontrada.`);
      }
      if (!phaseSet.has(point.phaseId)) {
        throw new NotFoundException(`Fase ${point.phaseId} no encontrada.`);
      }
      if (point.elementId && !elementSet.has(point.elementId)) {
        throw new NotFoundException(`Elemento ${point.elementId} no encontrado.`);
      }
    }

    // Autorización: el usuario debe poder enviar mediciones en CADA proyecto referenciado
    // (un batch malicioso podría mezclar fases de proyectos distintos).
    const projectIds = new Set(phases.map((p) => p.service.projectId));
    for (const projectId of projectIds) {
      await this.requireProjectPermission(userId, projectId, 'can_submit_measurements');
    }

    // Inserción masiva en transacción
    const [createdPoints] = await this.prisma.$transaction([
      this.prisma.dataPoint.createManyAndReturn({
        data: points.map((p) => ({
          value: p.value,
          fileUrl: p.fileUrl ?? null,
          variableId: p.variableId,
          elementId: p.elementId ?? null,
          phaseId: p.phaseId,
          createdById: userId,
        })),
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { points: { increment: 15 } },
      }),
      this.prisma.pointsLog.create({
        data: { userId, action: 'MEASUREMENT_UPLOAD', points: 15 },
      }),
    ]);

    return { success: true, count: createdPoints.length, points: createdPoints };
  }

  async getDataPoints(phaseId: string, elementId?: string) {
    return this.prisma.dataPoint.findMany({
      where: {
        phaseId,
        ...(elementId ? { elementId } : {}),
      },
      include: {
        variable: true,
        element: true,
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── OTP Seguridad (No Repudio) ───────────────────────────────────────────────
  //
  // La generación/verificación vive ahora en `OtpService` (general, aislado por
  // `purpose`). Aquí se delega con `purpose='METRICS_NONREPUDIATION'` conservando
  // el comportamiento externo del flujo de cubicaciones: mismo envío de correo,
  // mismo log `[DEV OTP]`, misma forma de respuesta.

  async generateOtp(email: string): Promise<{ success: boolean; message: string }> {
    const otp = await this.otp.generate(email, OTP_PURPOSES.METRICS_NONREPUDIATION);

    await this.emailService.send({
      to: email,
      subject: 'Clave Dinámica GMT Link (OTP)',
      body: `Tu código de seguridad temporal para autorizar la subida de cubicaciones/datos es: ${otp}. Válido por 5 minutos.`,
    });

    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(`[DEV OTP] Clave temporal generada para ${email}: ${otp}`);
    }

    return {
      success: true,
      message: 'Código OTP enviado al correo corporativo.',
    };
  }

  async verifyOtp(email: string, otp: string): Promise<boolean> {
    return this.otp.verify(email, OTP_PURPOSES.METRICS_NONREPUDIATION, otp);
  }

  // ── Cloud Functions Mock para Cliente PyQt ──────────────────────────────────

  async saveCubicacion(userId: string, body: SaveCubicacionDto) {
    const element = await this.prisma.element.findUnique({
      where: { code: body.reservorio_codigo },
      include: { project: { include: { services: true } } },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${body.reservorio_codigo} no encontrado.`);
    }

    // Obtener la fase activa — prioridad: phase_code del body > más reciente del proyecto
    const serviceIds = element.project.services.map((s) => s.id);
    const phase = await this.prisma.phase.findFirst({
      where: body.phase_code
        ? { code: body.phase_code }
        : serviceIds.length > 0
          ? { serviceId: { in: serviceIds } }
          : {},
      include: { variables: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!phase) {
      throw new NotFoundException('No se encontró ninguna fase activa para este elemento. Crea una fase en el servicio del proyecto primero.');
    }

    // Construir data points para las variables que existan en la fase
    const dataToInsert = Object.entries(body.datos)
      .map(([variableCode, val]) => {
        const variable = phase.variables.find((v) => v.code === variableCode);
        if (!variable) return null;
        return {
          value: String(val),
          variableId: variable.id,
          elementId: element.id,
          phaseId: phase.id,
          createdById: userId,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (dataToInsert.length === 0) {
      return { success: true, doc_id: null };
    }

    const [createdPoints] = await this.prisma.$transaction([
      this.prisma.dataPoint.createManyAndReturn({ data: dataToInsert }),
      this.prisma.user.update({
        where: { id: userId },
        data: { points: { increment: 15 } },
      }),
      this.prisma.pointsLog.create({
        data: { userId, action: 'MEASUREMENT_UPLOAD', points: 15 },
      }),
    ]);

    return { success: true, doc_id: createdPoints[0]?.id || null };
  }

  async createDemUploadUrl(body: { reservorio_codigo: string; filename: string }) {
    // Con R2 activo: URL firmada PUT directa a R2 bajo `dems/<reservorio>/<archivo>`.
    // El cliente de escritorio sube el .tif directo a R2, sin pasar por el backend.
    const r2 = this.r2;
    if (r2) {
      const key = this.demKey(body.reservorio_codigo, body.filename);
      return {
        upload_url: await r2.createPresignedPutUrl(key),
        blob_path: key,
      };
    }

    // Sin R2 (dev): mecanismo de token + subida a disco local (comportamiento previo).
    const uuid = randomUUID();
    const token = randomUUID();
    const cleanFilename = `${uuid}-${sanitizeFilename(body.filename)}`;

    this.tokens.set(token, cleanFilename);

    const baseUrl = this.publicBaseUrl();
    return {
      upload_url: `${baseUrl}/metrics/upload?token=${token}`,
      blob_path: `${baseUrl}/metrics/uploads/${cleanFilename}`,
    };
  }

  /** Construye la key R2 de un DEM: `dems/<reservorio>/<archivo>` (sanitizada, sin traversal). */
  private demKey(reservorioCodigo: string, filename: string): string {
    const safeReservorio = reservorioCodigo.replace(/[^a-zA-Z0-9_-]/g, '') || 'misc';
    return `dems/${safeReservorio}/${sanitizeFilename(filename)}`;
  }

  async registerDemMetadata(userId: string, body: { reservorio_codigo: string; archivo: string; blob_path: string; phase_code?: string }) {
    const element = await this.prisma.element.findUnique({
      where: { code: body.reservorio_codigo },
      include: { project: { include: { services: true } } },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${body.reservorio_codigo} no encontrado.`);
    }

    const serviceIds = element.project.services.map((s) => s.id);
    const phase = await this.prisma.phase.findFirst({
      where: body.phase_code
        ? { code: body.phase_code }
        : serviceIds.length > 0
          ? { serviceId: { in: serviceIds } }
          : {},
      include: { variables: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!phase) {
      throw new NotFoundException('No se encontró ninguna fase activa para este elemento.');
    }

    const demVariable = phase.variables.find((v) => v.code === 'dem_file');
    if (!demVariable) {
      throw new NotFoundException('Variable "dem_file" no configurada en la fase activa.');
    }

    const dataPoint = await this.prisma.dataPoint.create({
      data: {
        value: body.archivo,
        fileUrl: body.blob_path,
        variableId: demVariable.id,
        elementId: element.id,
        phaseId: phase.id,
        createdById: userId,
      },
    });

    return { success: true, doc_id: dataPoint.id };
  }

  async getLatestDem(body: { reservorio_codigo: string }) {
    const element = await this.prisma.element.findUnique({
      where: { code: body.reservorio_codigo },
      include: { project: { include: { services: true } } },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${body.reservorio_codigo} no encontrado.`);
    }

    // Buscar variable dem_file en cualquier fase del proyecto, la más reciente
    const serviceIds = element.project.services.map((s) => s.id);
    const demDataPoint = await this.prisma.dataPoint.findFirst({
      where: {
        elementId: element.id,
        variable: { code: 'dem_file' },
        phase: serviceIds.length > 0 ? { serviceId: { in: serviceIds } } : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!demDataPoint) {
      throw new NotFoundException(`No hay DEM registrado para ${body.reservorio_codigo}`);
    }

    return {
      blob_path: demDataPoint.fileUrl,
      filename: demDataPoint.value,
    };
  }

  async getDemDownloadUrl(body: { blob_path: string }) {
    // Con R2 activo y un blob_path que es una key (no una URL absoluta legacy),
    // firmamos una URL GET de descarga directa de R2 con vigencia acotada.
    const r2 = this.r2;
    if (r2 && !/^https?:\/\//i.test(body.blob_path)) {
      return {
        download_url: await r2.createPresignedGetUrl(body.blob_path),
      };
    }

    // Sin R2 (o blob_path legacy con URL absoluta): se devuelve tal cual.
    return {
      download_url: body.blob_path,
    };
  }

  async listDems(body: { reservorio_codigo: string }) {
    const element = await this.prisma.element.findUnique({
      where: { code: body.reservorio_codigo },
      include: { project: { include: { services: true } } },
    });
    if (!element) {
      return { rows: [] };
    }

    const serviceIds = element.project.services.map((s) => s.id);
    const list = await this.prisma.dataPoint.findMany({
      where: {
        elementId: element.id,
        variable: { code: 'dem_file' },
        phase: serviceIds.length > 0 ? { serviceId: { in: serviceIds } } : undefined,
      },
      include: {
        createdBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      rows: list.map((dp) => ({
        id: dp.id,
        archivo: dp.value,
        blob_path: dp.fileUrl,
        fecha_vuelo: dp.createdAt.toISOString().split('T')[0],
        usuario: `${dp.createdBy.firstName} ${dp.createdBy.lastName}`,
        drone: 'Matrice 300 RTK',
      })),
    };
  }

  async saveReservorioMetadata(userId: string, body: SaveReservorioMetadataDto) {
    // Si no se proporciona proyecto_id, intentamos usar el primer proyecto del usuario.
    let targetProjectId = body.proyecto_id;
    if (!targetProjectId) {
      const membership = await this.prisma.membership.findFirst({
        where: { userId, scopeType: 'PROJECT' },
      });
      if (membership) {
        targetProjectId = membership.scopeId;
      } else {
        // Si el usuario no pertenece a ningún proyecto, no podemos crear el elemento.
        // Se lanza error explícito en lugar de usar un ID hardcodeado.
        throw new BadRequestException(
          'El usuario no pertenece a ningún proyecto. No se puede registrar el reservorio sin un proyecto_id explícito.',
        );
      }
    }

    await this.requireProjectPermission(userId, targetProjectId, 'can_submit_measurements');

    const element = await this.prisma.element.upsert({
      where: { code: body.reservorio_codigo },
      update: {
        name: body.nombre,
        metadata: toInputJson(body.extra),
      },
      create: {
        code: body.reservorio_codigo,
        name: body.nombre,
        type: 'POZA',
        metadata: toInputJson(body.extra),
        projectId: targetProjectId,
      },
    });
    return { success: true, element };
  }

  // --- Asset management mocks ---
  async getAssetUploadUrl(body: { filename: string }) {
    const uuid = randomUUID();
    const token = randomUUID();
    const cleanFilename = `${uuid}-${sanitizeFilename(body.filename)}`;

    this.tokens.set(token, cleanFilename);

    const baseUrl = this.publicBaseUrl();
    return {
      upload_url: `${baseUrl}/metrics/upload?token=${token}`,
      asset_id: uuid,
      blob_path: `${baseUrl}/metrics/uploads/${cleanFilename}`,
    };
  }

  async getAssetDownloadUrl(body: { assetId?: string; blob_path?: string }) {
    const baseUrl = this.publicBaseUrl();
    return {
      download_url: body.blob_path || `${baseUrl}/metrics/uploads/${body.assetId}`,
    };
  }

  resolveToken(token: string): string | undefined {
    return this.tokens.get(token);
  }

  private publicBaseUrl(): string {
    return process.env.API_PUBLIC_URL ?? 'http://localhost:3001';
  }
}
