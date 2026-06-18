import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CreateElementDto, CreatePhaseDto, BulkSaveDataDto, GenerateOtpDto, VerifyOtpDto } from './dto/metrics.dto';
import { createWriteStream } from 'fs';
import { join } from 'path';

@Controller('metrics')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  // ── Elementos ────────────────────────────────────────────────────────────────

  @Post('elements')
  createPool(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CreateElementDto,
  ) {
    this.requireUser(user);
    return this.service.createPool(dto);
  }

  @Get('elements')
  getPools(
    @CurrentUser() user: AuthUser | undefined,
    @Query('projectId') projectId: string,
  ) {
    this.requireUser(user);
    return this.service.getPools(projectId);
  }

  @Get('elements/code/:code')
  getPoolByCode(
    @CurrentUser() user: AuthUser | undefined,
    @Param('code') code: string,
  ) {
    this.requireUser(user);
    return this.service.getPoolByCode(code);
  }

  // ── Fases & Variables ────────────────────────────────────────────────────────

  @Post('phases')
  createPhase(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CreatePhaseDto,
  ) {
    this.requireUser(user);
    return this.service.createPhase(dto);
  }

  @Get('phases')
  getPhases(
    @CurrentUser() user: AuthUser | undefined,
    @Query('serviceId') serviceId: string,
  ) {
    this.requireUser(user);
    return this.service.getPhases(serviceId);
  }

  @Get('variables')
  getVariables(
    @CurrentUser() user: AuthUser | undefined,
    @Query('phaseId') phaseId: string,
  ) {
    this.requireUser(user);
    return this.service.getVariables(phaseId);
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
  getDataPoints(
    @CurrentUser() user: AuthUser | undefined,
    @Param('phaseId') phaseId: string,
    @Query('elementId') elementId?: string,
  ) {
    this.requireUser(user);
    return this.service.getDataPoints(phaseId, elementId);
  }

  // ── OTP Seguridad ────────────────────────────────────────────────────────────

  @Post('otp/generate')
  generateOtp(@Body() dto: GenerateOtpDto) {
    return this.service.generateOtp(dto.email);
  }

  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const isValid = await this.service.verifyOtp(dto.email, dto.otp);
    return { success: isValid };
  }

  // ── Mock Cloud Functions (Desktop PyQt Client) ───────────────────────────────

  @Post('createDemUploadUrl')
  createDemUploadUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string; filename: string },
  ) {
    this.requireUser(user);
    return this.service.createDemUploadUrl(body);
  }

  @Post('registerDemMetadata')
  registerDemMetadata(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string; archivo: string; blob_path: string },
  ) {
    const userId = this.requireUserId(user);
    return this.service.registerDemMetadata(userId, body);
  }

  @Post('getLatestDem')
  getLatestDem(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string },
  ) {
    this.requireUser(user);
    return this.service.getLatestDem(body);
  }

  @Post('getDemDownloadUrl')
  getDemDownloadUrl(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { blob_path: string },
  ) {
    this.requireUser(user);
    return this.service.getDemDownloadUrl(body);
  }

  @Post('listDems')
  listDems(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string },
  ) {
    this.requireUser(user);
    return this.service.listDems(body);
  }

  @Post('saveReservorioMetadata')
  saveReservorioMetadata(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string; nombre: string; extra: any },
  ) {
    this.requireUser(user);
    return this.service.saveReservorioMetadata(body);
  }

  @Post('saveCubicacion')
  saveCubicacion(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { reservorio_codigo: string; datos: any },
  ) {
    const userId = this.requireUserId(user);
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
    @Body() body: { accion: string; detalle: any },
  ) {
    this.requireUser(user);
    console.log(`[PyQt Client Activity] Action: ${body.accion}`, body.detalle);
    return { success: true };
  }

  @Post('submitForReview')
  submitForReview(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { documentId: string },
  ) {
    this.requireUser(user);
    return { success: true, status: 'submitted' };
  }

  @Post('approveDocument')
  approveDocument(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { documentId: string },
  ) {
    this.requireUser(user);
    return { success: true, status: 'approved' };
  }

  @Post('rejectDocument')
  rejectDocument(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: { documentId: string },
  ) {
    this.requireUser(user);
    return { success: true, status: 'rejected' };
  }

  @Post('exportCubicacionToSheets')
  exportCubicacionToSheets(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: any,
  ) {
    this.requireUser(user);
    return { success: true, worksheet_title: 'Planilla Cubicaciones Atacama' };
  }

  // ── Raw Upload / Download Handlers ───────────────────────────────────────────

  @Put('upload')
  async handleRawUpload(
    @Query('token') token: string,
    @Req() req: any,
  ) {
    if (!token) {
      throw new UnauthorizedException('Token de carga requerido.');
    }
    const filename = this.service.resolveToken(token);
    if (!filename) {
      throw new UnauthorizedException('Token de carga no válido.');
    }

    const filePath = join(process.cwd(), 'uploads', filename);
    const writeStream = createWriteStream(filePath);

    req.pipe(writeStream);

    return new Promise((resolve, reject) => {
      req.on('end', () => {
        // Ejecutar procesamiento/simulación de cola en segundo plano (asíncrono)
        setTimeout(() => {
          console.log(`[Background Worker] Procesando archivo pesado: ${filename}`);
          // Aquí iría el traslado a R2/S3.
        }, 1000);

        resolve({ success: true, filename });
      });
      req.on('error', (err: any) => reject(err));
    });
  }

  @Get('uploads/:filename')
  downloadUploadedFile(@Param('filename') filename: string, @Res() res: any) {
    const filePath = join(process.cwd(), 'uploads', filename);
    return res.sendFile(filePath);
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
}
