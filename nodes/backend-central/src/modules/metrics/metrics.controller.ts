import { Body, Controller, Delete, ForbiddenException, Get, Logger, Param, Post, Put, Query, Req, Res, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { FgaService } from '../../fga/fga.service';
import { StorageService } from '../../common/storage/storage.service';
import { sanitizeFilename } from '../../common/storage/local-storage.service';
import {
  CreateElementDto,
  CreatePhaseDto,
  BulkSaveDataDto,
  GenerateOtpDto,
  VerifyOtpDto,
  SaveCubicacionDto,
  SaveReservorioMetadataDto,
  LogActivityDto,
  SetPhaseDataSpecDto,
} from './dto/metrics.dto';


@Controller('metrics')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);
  constructor(
    private readonly service: MetricsService,
    private readonly fga: FgaService,
    private readonly storage: StorageService,
  ) {}

  // ── Elementos ────────────────────────────────────────────────────────────────

  @Post('elements')
  async createPool(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CreateElementDto,
  ) {
    const userId = this.requireUserId(user);
    await this.requireProjectPermission(userId, dto.projectId, 'can_submit_measurements');
    return this.service.createPool(dto);
  }

  @Put('elements/:id')
  async updatePool(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: CreateElementDto,
  ) {
    const userId = this.requireUserId(user);
    await this.requireProjectPermission(userId, dto.projectId, 'can_submit_measurements');
    return this.service.updatePool(id, dto);
  }

  @Delete('elements/:id')
  async deletePool(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(user);
    const element = await this.service.getPoolById(id);
    await this.requireProjectPermission(userId, element.projectId, 'can_submit_measurements');
    return this.service.deletePool(id);
  }

  @Get('elements')
  async getPools(
    @CurrentUser() user: AuthUser | undefined,
    @Query('projectId') projectId: string,
  ) {
    const userId = this.requireUserId(user);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.getPools(projectId);
  }

  @Get('elements/code/:code')
  async getPoolByCode(
    @CurrentUser() user: AuthUser | undefined,
    @Param('code') code: string,
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForElementCode(code);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.getPoolByCode(code);
  }

  // ── Fases & Variables ────────────────────────────────────────────────────────

  @Post('phases')
  async createPhase(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CreatePhaseDto,
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForServiceId(dto.serviceId);
    await this.requireProjectPermission(userId, projectId, 'can_submit_measurements');
    return this.service.createPhase(dto);
  }

  @Get('phases')
  async getPhases(
    @CurrentUser() user: AuthUser | undefined,
    @Query('serviceId') serviceId: string,
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForServiceId(serviceId);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.getPhases(serviceId);
  }

  @Get('variables')
  async getVariables(
    @CurrentUser() user: AuthUser | undefined,
    @Query('phaseId') phaseId: string,
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForPhaseId(phaseId);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.getVariables(phaseId);
  }

  /**
   * Define/actualiza el DataSpec de una fase (variables a capturar).
   * Gate: can_submit_measurements sobre el proyecto de la fase (mismo que crear fase).
   */
  @Put('phases/:id/dataspec')
  async setPhaseDataSpec(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') phaseId: string,
    @Body() dto: SetPhaseDataSpecDto,
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForPhaseId(phaseId);
    await this.requireProjectPermission(userId, projectId, 'can_submit_measurements');
    return this.service.setPhaseDataSpec(phaseId, dto);
  }

  // ── Datos de Medición / Cubicaciones ─────────────────────────────────────────

  @Post('data')
  saveDataPoints(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: BulkSaveDataDto,
  ) {
    const userId = this.requireUserId(user);
    return this.service.saveDataPoints(userId, dto.points);
  }

  @Get('data/:phaseId')
  async getDataPoints(
    @CurrentUser() user: AuthUser | undefined,
    @Param('phaseId') phaseId: string,
    @Query('elementId') elementId?: string,
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForPhaseId(phaseId);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.getDataPoints(phaseId, elementId);
  }

  // ── OTP Seguridad ────────────────────────────────────────────────────────────

  @Post('otp/generate')
  generateOtp(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: GenerateOtpDto,
  ) {
    this.requireMatchingEmail(user, dto.email);
    return this.service.generateOtp(dto.email);
  }

  @Post('otp/verify')
  async verifyOtp(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: VerifyOtpDto,
  ) {
    this.requireMatchingEmail(user, dto.email);
    const isValid = await this.service.verifyOtp(dto.email, dto.otp);
    return { success: isValid };
  }

  // ── Mock Cloud Functions (Desktop PyQt Client) ───────────────────────────────

  @Post('createDemUploadUrl')
  async createDemUploadUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string; filename: string },
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForElementCode(body.reservorio_codigo);
    await this.requireProjectPermission(userId, projectId, 'can_submit_measurements');
    return this.service.createDemUploadUrl(body);
  }

  @Post('registerDemMetadata')
  async registerDemMetadata(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string; archivo: string; blob_path: string },
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForElementCode(body.reservorio_codigo);
    await this.requireProjectPermission(userId, projectId, 'can_submit_measurements');
    return this.service.registerDemMetadata(userId, body);
  }

  @Post('getLatestDem')
  async getLatestDem(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string },
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForElementCode(body.reservorio_codigo);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.getLatestDem(body);
  }

  @Post('getDemDownloadUrl')
  async getDemDownloadUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { blob_path: string },
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForDemBlobPath(body.blob_path);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.getDemDownloadUrl(body);
  }

  @Post('listDems')
  async listDems(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string },
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForElementCode(body.reservorio_codigo);
    await this.requireProjectPermission(userId, projectId, 'can_view');
    return this.service.listDems(body);
  }

  @Post('saveReservorioMetadata')
  saveReservorioMetadata(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: SaveReservorioMetadataDto,
  ) {
    const userId = this.requireUserId(user);
    return this.service.saveReservorioMetadata(userId, body);
  }

  @Post('saveCubicacion')
  async saveCubicacion(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: SaveCubicacionDto,
  ) {
    const userId = this.requireUserId(user);
    const projectId = await this.service.getProjectIdForElementCode(body.reservorio_codigo);
    await this.requireProjectPermission(userId, projectId, 'can_submit_measurements');
    return this.service.saveCubicacion(userId, body);
  }

  @Post('getAssetUploadUrl')
  getAssetUploadUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { filename: string },
  ) {
    this.requireUser(user);
    return this.service.getAssetUploadUrl(body);
  }

  @Post('getAssetDownloadUrl')
  getAssetDownloadUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { assetId?: string; blob_path?: string },
  ) {
    this.requireUser(user);
    return this.service.getAssetDownloadUrl(body);
  }

  @Post('logActivity')
  logActivity(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: LogActivityDto,
  ) {
    this.requireUser(user);
    this.logger.log(`[PyQt Client Activity] Action: ${body.accion} | Detail: ${JSON.stringify(body.detalle)}`);
    return { success: true };
  }









  // ── Raw Upload / Download Handlers ───────────────────────────────────────────

   @Put('upload')
   async handleRawUpload(
     @Query('token') token: string,
     @Req() req: Request,
   ) {
     if (!token) {
       throw new UnauthorizedException('Token de carga requerido.');
     }
     const filename = this.service.resolveToken(token);
     if (!filename) {
       throw new UnauthorizedException('Token de carga no válido.');
     }

     // Check Content-Length header first
     const contentLength = req.headers['content-length'];
     if (contentLength) {
       const size = parseInt(contentLength, 10);
       const maxBytes = await this.getMaxBytes();
       if (size > maxBytes) {
         throw new ForbiddenException(`El archivo supera el máximo permitido (${maxBytes} bytes).`);
       }
     }

     // Stream with size limit to prevent memory exhaustion
     const chunks: Buffer[] = [];
     let receivedBytes = 0;
     const maxBytes = await this.getMaxBytes();

     const buffer = await new Promise<Buffer>((resolve, reject) => {
       req.on('data', (chunk) => {
         receivedBytes += chunk.length;
         if (receivedBytes > maxBytes) {
           req.destroy(); // Destroy the socket to stop receiving data
           reject(new ForbiddenException(`El archivo supera el máximo permitido (${maxBytes} bytes).`));
           return;
         }
         chunks.push(chunk);
       });
       req.on('end', () => resolve(Buffer.concat(chunks)));
       req.on('error', (err) => reject(err));
     });

     const contentType = req.headers['content-type'] || 'application/octet-stream';
     await this.storage.save({
       buffer,
       filename,
       contentType,
       folder: 'metrics',
       customFilename: filename,
     });

     // Ejecutar procesamiento/simulación de cola en segundo plano (asíncrono)
     setTimeout(() => {
       this.logger.log(`[Background Worker] Procesando archivo pesado: ${filename}`);
       // Aquí iría el traslado a R2/S3.
     }, 1000);

     return { success: true, filename };
   }

   private async getMaxBytes(): Promise<number> {
     const raw = process.env.STORAGE_MAX_BYTES;
     if (raw === undefined) {
       return 10 * 1024 * 1024; // 10 MB default
     }
     const parsed = Number(raw);
     return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10 * 1024 * 1024;
   }

  @Get('uploads/:filename')
  async downloadUploadedFile(
    @CurrentUser() user: AuthUser | undefined,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    // Requiere sesión (antes era de acceso público total — el riesgo residual de
    // un usuario autenticado de OTRO proyecto adivinando un filename UUID-prefijado
    // queda documentado y pendiente para una iteración futura, ver plan §1.2).
    this.requireUser(user);
    const buffer = await this.storage.read(`metrics/${filename}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
    res.end(buffer);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private requireUser(user: AuthUser | undefined): void {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para acceder a las métricas.');
    }
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }

  /** El OTP solo puede solicitarse/verificarse para el correo de la sesión activa. */
  private requireMatchingEmail(user: AuthUser | undefined, email: string): void {
    if (!user || !user.email || user.email !== email) {
      throw new ForbiddenException('Debes iniciar sesión con el correo correspondiente para esta operación.');
    }
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
}
