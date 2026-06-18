import { Injectable, NotFoundException, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email.service';
import { CreateElementDto, CreatePhaseDto, SaveDataPointDto } from './dto/metrics.dto';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

interface OtpData {
  otp: string;
  expiresAt: number;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly otps = new Map<string, OtpData>();
  private readonly tokens = new Map<string, string>(); // token -> filename

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {
    // Asegurar directorio de subidas
    const uploadDir = join(process.cwd(), 'uploads');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
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
        metadata: dto.metadata || {},
        projectId: dto.projectId,
      },
      create: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        locationPolygon: dto.locationPolygon,
        metadata: dto.metadata || {},
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
      this.prisma.phase.findMany({ where: { id: { in: phaseIds } }, select: { id: true } }),
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

  async generateOtp(email: string): Promise<{ success: boolean; message: string }> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const ttl = 5 * 60 * 1000; // 5 minutos de validez
    const expiresAt = Date.now() + ttl;

    this.otps.set(email, { otp, expiresAt });

    await this.emailService.send({
      to: email,
      subject: 'Clave Dinámica GMT Link (OTP)',
      body: `Tu código de seguridad temporal para autorizar la subida de cubicaciones/datos es: ${otp}. Válido por 5 minutos.`,
    });

    this.logger.log(`[DEV OTP BYPASS] Clave temporal generada para ${email}: ${otp}`);

    return {
      success: true,
      message: 'Código OTP enviado al correo corporativo.',
    };
  }

  async verifyOtp(email: string, otp: string): Promise<boolean> {
    const data = this.otps.get(email);
    if (!data) {
      throw new BadRequestException('No se ha generado ningún código OTP para este correo.');
    }

    if (Date.now() > data.expiresAt) {
      this.otps.delete(email);
      throw new BadRequestException('El código OTP ha expirado.');
    }

    if (data.otp !== otp) {
      throw new BadRequestException('Código OTP incorrecto.');
    }

    this.otps.delete(email);
    return true;
  }

  // ── Cloud Functions Mock para Cliente PyQt ──────────────────────────────────

  async saveCubicacion(userId: string, body: { reservorio_codigo: string; datos: any }) {
    const element = await this.prisma.element.findUnique({
      where: { code: body.reservorio_codigo },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${body.reservorio_codigo} no encontrado.`);
    }

    // Obtener la fase activa
    const phase = await this.prisma.phase.findFirst({
      where: { code: 'anual-2026' },
      include: { variables: true },
    });
    if (!phase) {
      throw new NotFoundException('Fase activa "anual-2026" no encontrada.');
    }

    const createdPoints = [];

    // Iterar sobre las variables y guardarlas en dataPoints
    for (const variableCode of Object.keys(body.datos)) {
      const val = body.datos[variableCode];
      const variable = phase.variables.find((v) => v.code === variableCode);
      if (variable) {
        const dataPoint = await this.prisma.dataPoint.create({
          data: {
            value: String(val),
            variableId: variable.id,
            elementId: element.id,
            phaseId: phase.id,
            createdById: userId,
          },
        });
        createdPoints.push(dataPoint);
      }
    }

    // Registrar en logs de gamificación
    await this.prisma.user.update({
      where: { id: userId },
      data: { points: { increment: 15 } },
    });

    await this.prisma.pointsLog.create({
      data: {
        userId,
        action: 'MEASUREMENT_UPLOAD',
        points: 15,
      },
    });

    return { success: true, doc_id: createdPoints[0]?.id || 'mock-doc-id' };
  }

  async createDemUploadUrl(body: { reservorio_codigo: string; filename: string }) {
    const uuid = randomUUID();
    const token = randomUUID();
    const cleanFilename = `${uuid}-${body.filename}`;

    this.tokens.set(token, cleanFilename);

    const baseUrl = this.publicBaseUrl();
    return {
      upload_url: `${baseUrl}/metrics/upload?token=${token}`,
      blob_path: `${baseUrl}/metrics/uploads/${cleanFilename}`,
    };
  }

  async registerDemMetadata(userId: string, body: { reservorio_codigo: string; archivo: string; blob_path: string }) {
    const element = await this.prisma.element.findUnique({
      where: { code: body.reservorio_codigo },
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${body.reservorio_codigo} no encontrado.`);
    }

    const phase = await this.prisma.phase.findFirst({
      where: { code: 'anual-2026' },
      include: { variables: true },
    });
    if (!phase) {
      throw new NotFoundException('Fase activa "anual-2026" no encontrada.');
    }

    const demVariable = phase.variables.find((v) => v.code === 'dem_file');
    if (!demVariable) {
      throw new NotFoundException('Variable "dem_file" no configurada.');
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
    });
    if (!element) {
      throw new NotFoundException(`Elemento con código ${body.reservorio_codigo} no encontrado.`);
    }

    const phase = await this.prisma.phase.findFirst({
      where: { code: 'anual-2026' },
      include: { variables: true },
    });
    if (!phase) {
      throw new NotFoundException('Fase activa "anual-2026" no encontrada.');
    }

    const demVariable = phase.variables.find((v) => v.code === 'dem_file');
    if (!demVariable) {
      throw new NotFoundException('Variable "dem_file" no configurada.');
    }

    const latest = await this.prisma.dataPoint.findFirst({
      where: {
        elementId: element.id,
        variableId: demVariable.id,
        phaseId: phase.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      throw new NotFoundException(`No hay DEM registrado para ${body.reservorio_codigo}`);
    }

    return {
      blob_path: latest.fileUrl,
      filename: latest.value,
    };
  }

  async getDemDownloadUrl(body: { blob_path: string }) {
    return {
      download_url: body.blob_path,
    };
  }

  async listDems(body: { reservorio_codigo: string }) {
    const element = await this.prisma.element.findUnique({
      where: { code: body.reservorio_codigo },
    });
    if (!element) {
      return { rows: [] };
    }

    const phase = await this.prisma.phase.findFirst({
      where: { code: 'anual-2026' },
      include: { variables: true },
    });
    if (!phase) {
      return { rows: [] };
    }

    const demVariable = phase.variables.find((v) => v.code === 'dem_file');
    if (!demVariable) {
      return { rows: [] };
    }

    const list = await this.prisma.dataPoint.findMany({
      where: {
        elementId: element.id,
        variableId: demVariable.id,
        phaseId: phase.id,
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

  async saveReservorioMetadata(userId: string, body: { reservorio_codigo: string; nombre: string; extra: any; proyecto_id?: string }) {
    // Si no se proporciona proyecto_id, intentamos usar el primer proyecto del usuario.
    let targetProjectId = body.proyecto_id;
    if (!targetProjectId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { userProjects: true },
      });
      if (user?.userProjects?.length > 0) {
        targetProjectId = user.userProjects[0].projectId;
      } else {
        // Si el usuario no pertenece a ningún proyecto, no podemos crear el elemento.
        // Se lanza error explícito en lugar de usar un ID hardcodeado.
        throw new BadRequestException(
          'El usuario no pertenece a ningún proyecto. No se puede registrar el reservorio sin un proyecto_id explícito.',
        );
      }
    }

    const element = await this.prisma.element.upsert({
      where: { code: body.reservorio_codigo },
      update: {
        name: body.nombre,
        metadata: body.extra || {},
      },
      create: {
        code: body.reservorio_codigo,
        name: body.nombre,
        type: 'POZA',
        metadata: body.extra || {},
        projectId: targetProjectId,
      },
    });
    return { success: true, element };
  }

  // --- Asset management mocks ---
  async getAssetUploadUrl(body: { filename: string }) {
    const uuid = randomUUID();
    const token = randomUUID();
    const cleanFilename = `${uuid}-${body.filename}`;

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
