import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ORG_ID, ORG_OBJECT_TYPE } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { FgaService } from '../../fga/fga.service';
import { ReimbursementsService } from './reimbursements.service';
import {
  CreateReimbursementDto,
  ListReimbursementsQueryDto,
  RejectReimbursementDto,
} from './dto/reimbursements.dto';
import type { ReimbursementView } from './reimbursements.types';

/** Permiso FGA de gestión de finanzas (§6-3.1). */
const FINANCE_RELATION = 'can_manage_finance';

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
 * Reembolsos (§6-3.1 — `RoleScopedList` + `RequestForm`).
 *
 * Rutas propias (`/me`, crear, boleta): AUTENTICADAS, "solo el dueño" como lógica
 * de service (userId de la sesión). Rutas de GESTIÓN (lista global, approve/
 * reject/pay): protegidas por `@RequirePermission('can_manage_finance',
 * organization:gmt)` → 403 si no es gestor. `GET /reimbursements/:id` es
 * autenticada y admite dueño O gestor: el controller resuelve `isManager` con un
 * check FGA y el service decide el 404.
 *
 * `/me` se declara ANTES que `:id` para que el literal no sea capturado por el
 * parámetro de ruta.
 */
@Controller('reimbursements')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ReimbursementsController {
  constructor(
    private readonly reimbursements: ReimbursementsService,
    private readonly fga: FgaService,
  ) {}

  /** Crea un reembolso propio (PENDIENTE). */
  @Post()
  create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateReimbursementDto,
  ): Promise<ReimbursementView> {
    return this.reimbursements.create(this.requireUserId(authUser), dto);
  }

  /** Lista los reembolsos propios. Filtro opcional `?status=`. */
  @Get('me')
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListReimbursementsQueryDto,
  ): Promise<ReimbursementView[]> {
    return this.reimbursements.listMine(this.requireUserId(authUser), query.status);
  }

  /**
   * Lista TODOS los reembolsos (gestor — RoleScopedList). Filtros opcionales
   * `?status=&userId=`. Requiere `can_manage_finance` sobre `organization:gmt`.
   */
  @Get()
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  listAll(@Query() query: ListReimbursementsQueryDto): Promise<ReimbursementView[]> {
    return this.reimbursements.listAll({ status: query.status, userId: query.userId });
  }

  /**
   * Detalle de un reembolso. Autenticada: lo ve el DUEÑO o un GESTOR. El
   * controller resuelve `isManager` con un check FGA; el service decide el 404.
   */
  @Get(':id')
  async getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    const isManager = await this.isFinanceManager(userId);
    return this.reimbursements.getById(id, userId, isManager);
  }

  /**
   * Sube/actualiza la boleta (multipart, campo `file` PDF/imagen). SOLO el dueño
   * y solo si está PENDIENTE.
   */
  @Post(':id/receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  attachReceipt(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ReimbursementView> {
    const userId = this.requireUserId(authUser);
    const checked = this.requireValidFile(file);
    return this.reimbursements.attachReceipt(userId, id, checked);
  }

  /** Aprueba un reembolso (gestor). PENDIENTE→APROBADO. 409 si estado inválido. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    return this.reimbursements.approve(this.requireUserId(authUser), id);
  }

  /** Rechaza un reembolso (gestor). PENDIENTE→RECHAZADO. `reason` opcional (log). */
  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectReimbursementDto,
  ): Promise<ReimbursementView> {
    return this.reimbursements.reject(this.requireUserId(authUser), id, dto.reason);
  }

  /** Marca pagado un reembolso (gestor). Solo desde APROBADO→PAGADO. 409 si no. */
  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  pay(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ReimbursementView> {
    return this.reimbursements.pay(this.requireUserId(authUser), id);
  }

  /** ¿El usuario es gestor de finanzas (FGA `can_manage_finance` sobre la org)? */
  private isFinanceManager(userId: string): Promise<boolean> {
    return this.fga.check({
      user: `user:${userId}`,
      relation: FINANCE_RELATION,
      object: `${ORG_OBJECT_TYPE}:${ORG_ID}`,
    });
  }

  /** Valida presencia y MIME del archivo subido; retorna su forma mínima. */
  private requireValidFile(file: Express.Multer.File | undefined): {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  } {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        'El archivo debe ser PDF o imagen (PNG/JPEG/WebP/HEIC).',
      );
    }
    return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype };
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
