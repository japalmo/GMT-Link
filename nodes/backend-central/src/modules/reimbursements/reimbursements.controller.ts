import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FinanceStatus } from '@prisma/client';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { PermissionService } from '../../authz/permission.service';
import { ReimbursementsService } from './reimbursements.service';
import {
  CreateReimbursementDto,
  ListReimbursementsQueryDto,
  MarkPrintedDto,
  PrintReimbursementsDto,
  RejectReimbursementDto,
  UpdateReimbursementDto,
} from './dto/reimbursements.dto';
import type { Paginated, ReceiptScanResult, ReimbursementView } from './reimbursements.types';
import type { ReimbursementSummary } from './reimbursements-summary.util';

/** Permisos funcionales de finanzas (spec §2.2). */
const P_CREATE = 'finance:request:create';
const P_VIEW_ALL = 'finance:request:view:all';
const P_APPROVE = 'finance:request:approve';
const P_PAY = 'finance:payment:register';
const P_PRINT = 'finance:print:batch';

/** Tamaño máximo de la boleta (10 MB) — alineado con el storage. */
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** MIME types aceptados para la boleta: PDF e imágenes comunes (§6-3.1). */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
]);

/**
 * Reembolsos (spec §5). Gating por PERMISO FUNCIONAL vía `PermissionService.can`
 * inline (patrón ClientsController), no por FGA. Rutas propias (`/me`, crear,
 * boleta, scan) requieren `finance:request:create`; la gestión requiere el permiso
 * específico. `/me`, `/summary`, `/scan-receipt`, `/print` se declaran ANTES de `:id`.
 */
@Controller('reimbursements')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ReimbursementsController {
  constructor(
    private readonly reimbursements: ReimbursementsService,
    private readonly permissions: PermissionService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateReimbursementDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    // La boleta es obligatoria: requireValidFile lanza 400 si falta y 415 por MIME.
    const checked = this.requireValidFile(file);
    return this.reimbursements.create(userId, dto, checked);
  }

  /** OCR de boleta: imagen multipart → campos sugeridos (spec §5.5). */
  @Post('scan-receipt')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async scanReceipt(
    @CurrentUser() authUser: AuthUser | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ReceiptScanResult> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    const checked = this.requireValidFile(file);
    const dataUrl = `data:${checked.mimetype};base64,${checked.buffer.toString('base64')}`;
    return this.reimbursements.scanReceipt(userId, dataUrl);
  }

  @Post('print')
  @HttpCode(200)
  async print(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: PrintReimbursementsDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.require(this.requireUserId(authUser), P_PRINT);
    const pdf = await this.reimbursements.generateBatchPdf(dto.ids, {
      perPage: dto.perPage,
      orientation: dto.orientation,
      size: dto.size,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="boletas-reembolsos.pdf"');
    res.end(Buffer.from(pdf));
  }

  @Post('print/mark')
  @HttpCode(200)
  async markPrinted(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: MarkPrintedDto,
  ): Promise<{ marked: number }> {
    await this.require(this.requireUserId(authUser), P_PRINT);
    return this.reimbursements.markPrinted(dto.ids);
  }

  @Get('me')
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListReimbursementsQueryDto,
  ): Promise<Paginated<ReimbursementView>> {
    return this.reimbursements.listMine(this.requireUserId(authUser), {
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('summary')
  async summary(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListReimbursementsQueryDto,
  ): Promise<ReimbursementSummary> {
    await this.require(this.requireUserId(authUser), P_VIEW_ALL);
    return this.reimbursements.summary(this.toFilters(query));
  }

  @Get()
  async listAll(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListReimbursementsQueryDto,
  ): Promise<Paginated<ReimbursementView>> {
    await this.require(this.requireUserId(authUser), P_VIEW_ALL);
    return this.reimbursements.listAll(this.toFilters(query));
  }

  /**
   * Lista con el MOTOR de tablas server-side (offset): filtro por estado y orden
   * (fecha/monto/estado/solicitante) sobre TODOS los reembolsos, con página + total.
   * Lo consume la tabla de Gestión. Mismo gate P_VIEW_ALL que `listAll`. DEBE
   * declararse antes de `@Get(':id')`.
   */
  @Get('table')
  async listTable(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<TablePage<ReimbursementView>> {
    await this.require(this.requireUserId(authUser), P_VIEW_ALL);
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters: filters && typeof filters === 'object' ? filters : undefined,
    };
    const rawStatus = typeof filters?.status === 'string' ? filters.status : '';
    const status = (Object.values(FinanceStatus) as string[]).includes(rawStatus)
      ? (rawStatus as FinanceStatus)
      : undefined;
    return this.reimbursements.listAllTable({ status }, req);
  }

  @Get(':id')
  async getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    const isManager = (await this.permissions.can(userId, P_VIEW_ALL)).effect === 'allow';
    return this.reimbursements.getById(id, userId, isManager);
  }

  @Post(':id/receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async attachReceipt(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    const checked = this.requireValidFile(file);
    return this.reimbursements.attachReceipt(userId, id, checked);
  }

  /** Edita un reembolso propio (JSON). Solo el dueño y solo mientras sigue PENDIENTE. */
  @Put(':id')
  async update(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateReimbursementDto,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    return this.reimbursements.update(userId, id, dto);
  }

  /**
   * Elimina un reembolso: el DUEÑO borra el suyo, o quien GESTIONA finanzas
   * (`finance:request:approve`) borra cualquiera. En cualquier estado salvo PAGADO.
   * La autorización la decide EL SERVICE (ADR-0001): 404 para quien no es dueño ni
   * gestor, 409 si está pagada.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    const userId = this.requireUserId(authUser);
    // El SERVICE es el único gate (ADR-0001): borra el dueño o quien gestiona finanzas;
    // 404 para el resto, 409 si está pagada.
    const canManage = (await this.permissions.can(userId, P_APPROVE)).effect === 'allow';
    await this.reimbursements.remove(userId, id, canManage);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.reimbursements.approve(userId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectReimbursementDto,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.reimbursements.reject(userId, id, dto.reason);
  }

  @Post(':id/pay')
  @HttpCode(200)
  async pay(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_PAY);
    return this.reimbursements.pay(userId, id);
  }

  private toFilters(q: ListReimbursementsQueryDto): {
    status?: (typeof q)['status'];
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    date?: string;
    month?: string;
    order?: 'asc' | 'desc';
    printed?: boolean;
    limit?: number;
    cursor?: string;
  } {
    return {
      status: q.status,
      userId: q.userId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      date: q.date,
      month: q.month,
      order: q.order,
      printed: q.printed,
      limit: q.limit,
      cursor: q.cursor,
    };
  }

  private async require(userId: string, permissionKey: string): Promise<void> {
    const decision = await this.permissions.can(userId, permissionKey);
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para esta acción de finanzas.');
    }
  }

  private requireValidFile(file: Express.Multer.File | undefined): {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  } {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException('El archivo debe ser PDF o imagen (PNG/JPEG/WebP/HEIC).');
    }
    return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype };
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
