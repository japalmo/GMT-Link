import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AssetStatus, AssetType } from '@prisma/client';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { FgaService } from '../../fga/fga.service';
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  UpdateAssetDto,
  UpdateAssetStatusDto,
  AssignAssetDto,
  ReviewAssetDocDto,
  CreateAccessoryDto,
  UpdateAccessoryDto,
  UpdateChecklistTemplateDto,
  ReviewChecklistTemplateDto,
  SubmitChecklistDto,
  SubmitTelemetryDto,
} from './dto/assets.dto';
import {
  AssetDocumentView,
  AssetHistoryEntryView,
  AssetPublicView,
  AssetView,
  AssetAccessoryView,
  ChecklistTemplateView,
  ChecklistSubmissionView,
  Paginated,
} from './assets.types';

@Controller('assets')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly fga: FgaService,
  ) {}

  /**
   * Crea un nuevo activo (tipo, nombre, etc.).
   * Valida permisos en FGA dinámicamente si hay un proyecto asociado.
   */
  @Post()
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateAssetDto,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);

    if (dto.projectId) {
      const hasProjAccess = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_assets',
        object: `project:${dto.projectId}`,
      });
      if (!hasProjAccess) {
        throw new ForbiddenException('No tienes permisos para registrar activos en este proyecto.');
      }
    } else {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: 'organization:gmt',
      });
      if (!isGlobalAdmin) {
        throw new ForbiddenException('No tienes permisos para registrar activos globales.');
      }
    }

    return this.assets.create(userId, dto);
  }

  /**
   * Lista los activos visibles por el usuario con paginación keyset y filtros
   * opcionales. Devuelve una página (`items` + `nextCursor`): el cliente pide la
   * siguiente reenviando `nextCursor` como `cursor`. `search` filtra server-side
   * por código / nombre / descripción.
   */
  @Get()
  listAll(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('type') type?: AssetType,
    @Query('status') status?: AssetStatus,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
  ): Promise<Paginated<AssetView>> {
    const userId = this.requireUserId(authUser);
    return this.assets.listAll(userId, {
      type,
      status,
      projectId,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
      search,
    });
  }

  /**
   * Lista con el MOTOR de tablas server-side (offset): búsqueda, filtro (type/status/
   * projectId) y orden se resuelven sobre TODO el dataset visible y se devuelve una
   * página numerada + total. Lo consume la tabla del catálogo de recursos. DEBE
   * declararse antes de `@Get(':id')` para que el segmento estático "table" no lo
   * capture el param.
   */
  @Get('table')
  listTable(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<TablePage<AssetView>> {
    const userId = this.requireUserId(authUser);
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      search,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters: filters && typeof filters === 'object' ? filters : undefined,
    };
    return this.assets.listAllTable(userId, req);
  }

  /**
   * Ficha pública accesible sin autenticación por código QR.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // 20/min por IP: endpoint sin auth
  @Get('public/:token')
  getPublicByToken(@Param('token') token: string): Promise<AssetPublicView> {
    return this.assets.getPublicByToken(token);
  }

  /**
   * Detalle de un activo. Lectura pura: la autorización (funcional `asset:read`
   * con respaldo estructural por-activo) la resuelve el servicio, no el guard.
   */
  @Get(':id')
  async getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);
    const asset = await this.assets.getById(id, userId);
    // Adjunta `canManageAssets` (mismo permiso que exigen las mutaciones de
    // accesorios/asignación/checklist) para que el front muestre las acciones a
    // quien de verdad puede, en vez de aproximar por roles en el cliente.
    const canManageAssets = asset.projectId
      ? await this.fga.check({
          user: `user:${userId}`,
          relation: 'can_manage_assets',
          object: `project:${asset.projectId}`,
        })
      : await this.fga.check({
          user: `user:${userId}`,
          relation: 'admin',
          object: 'organization:gmt',
        });
    return { ...asset, canManageAssets };
  }

  /**
   * Edita los campos DESCRIPTIVOS del activo (Tanda 5.2): nombre, descripción,
   * fabricante, identificador/tipo, subtipo de vehículo y metadata. El servicio
   * exige `can_manage_assets`. `@Patch` no colisiona con `@Get`/`@Put` de `:id`.
   */
  @Patch(':id')
  async update(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);
    const updated = await this.assets.update(id, userId, dto);
    // Quien editó cumplió `can_manage_assets`; el front conserva las acciones de gestión.
    return { ...updated, canManageAssets: true };
  }

  /**
   * Cambia el estado del activo (DISPONIBLE, MANTENIMIENTO, etc.).
   */
  @Put(':id/status')
  updateStatus(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAssetStatusDto,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);
    return this.assets.updateStatus(id, userId, dto);
  }

  /**
   * Asigna un colaborador responsable para el activo.
   */
  @Put(':id/assign')
  async assign(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: AssignAssetDto,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);
    const asset = await this.assets.getById(id, userId);

    if (asset.projectId) {
      const canAssign = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_assets',
        object: `project:${asset.projectId}`,
      });
      if (!canAssign) {
        throw new ForbiddenException('No tienes permisos para asignar responsables a activos de este proyecto.');
      }
    } else {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: 'organization:gmt',
      });
      if (!isGlobalAdmin) {
        throw new ForbiddenException('No tienes permisos para asignar responsables a este activo.');
      }
    }

    return this.assets.assign(id, userId, dto.assignedToId ?? null);
  }

  /**
   * Disputa "en uso": toma un activo para utilizarlo.
   */
  @Post(':id/use')
  @HttpCode(200)
  @RequirePermission('can_view_list', { type: 'asset', param: 'id' })
  takeUse(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);
    return this.assets.takeUse(id, userId);
  }

  /**
   * Disputa "en uso": libera el activo.
   */
  @Post(':id/release')
  @HttpCode(200)
  @RequirePermission('can_view_list', { type: 'asset', param: 'id' })
  releaseUse(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);
    return this.assets.releaseUse(id, userId);
  }

  /**
   * Sube un documento asociado al activo.
   */
  @Post(':id/documents')
  @RequirePermission('can_upload_doc', { type: 'asset', param: 'id' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDocument(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body('name') name: string,
    @Body('type') type: string,
    @Body('expirationDate') expirationDate: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AssetDocumentView> {
    const userId = this.requireUserId(authUser);
    if (!name || !type) {
      throw new BadRequestException('El nombre y el tipo de documento son requeridos.');
    }
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }
    return this.assets.uploadDocument(
      id,
      userId,
      name,
      type,
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      },
      expirationDate,
    );
  }

  /**
   * Obtiene la lista de documentos cargados en el activo.
   */
  @Get(':id/documents')
  listDocuments(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<AssetDocumentView[]> {
    const userId = this.requireUserId(authUser);
    return this.assets.listDocuments(id, userId);
  }

  /**
   * Aprueba o rechaza un documento del activo.
   */
  @Post(':id/documents/:docId/review')
  @HttpCode(200)
  async reviewDocument(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: ReviewAssetDocDto,
  ): Promise<AssetDocumentView> {
    const userId = this.requireUserId(authUser);
    const isGlobalAdmin = await this.fga.check({
      user: `user:${userId}`,
      relation: 'admin',
      object: 'organization:gmt',
    });
    if (!isGlobalAdmin) {
      throw new ForbiddenException('No tienes permisos para revisar documentos de activos.');
    }
    return this.assets.reviewDocument(id, docId, userId, dto.status, dto.reason);
  }

  /**
   * Obtiene la línea de tiempo del activo.
   */
  @Get(':id/history')
  getHistory(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<AssetHistoryEntryView[]> {
    const userId = this.requireUserId(authUser);
    return this.assets.getHistory(id, userId);
  }

  /**
   * Obtiene la lista de accesorios del activo.
   */
  @Get(':id/accessories')
  listAccessories(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<AssetAccessoryView[]> {
    const userId = this.requireUserId(authUser);
    return this.assets.listAccessories(id, userId);
  }

  /**
   * Agrega un nuevo accesorio al activo.
   */
  @Post(':id/accessories')
  async addAccessory(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: CreateAccessoryDto,
  ): Promise<AssetAccessoryView> {
    const userId = this.requireUserId(authUser);
    const asset = await this.assets.getById(id, userId);

    if (asset.projectId) {
      const hasProjAccess = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_assets',
        object: `project:${asset.projectId}`,
      });
      if (!hasProjAccess) {
        throw new ForbiddenException('No tienes permisos para agregar accesorios a activos en este proyecto.');
      }
    } else {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: 'organization:gmt',
      });
      if (!isGlobalAdmin) {
        throw new ForbiddenException('No tienes permisos para gestionar activos globales.');
      }
    }

    return this.assets.addAccessory(id, userId, dto);
  }

  /**
   * Actualiza un accesorio del activo.
   */
  @Put(':id/accessories/:accId')
  async updateAccessory(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('accId') accId: string,
    @Body() dto: UpdateAccessoryDto,
  ): Promise<AssetAccessoryView> {
    const userId = this.requireUserId(authUser);
    const asset = await this.assets.getById(id, userId);

    if (asset.projectId) {
      const hasProjAccess = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_assets',
        object: `project:${asset.projectId}`,
      });
      if (!hasProjAccess) {
        throw new ForbiddenException('No tienes permisos para modificar accesorios en este proyecto.');
      }
    } else {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: 'organization:gmt',
      });
      if (!isGlobalAdmin) {
        throw new ForbiddenException('No tienes permisos para gestionar activos globales.');
      }
    }

    return this.assets.updateAccessory(id, accId, userId, dto);
  }

  /**
   * Elimina un accesorio del activo.
   */
  @Delete(':id/accessories/:accId')
  @HttpCode(204)
  async removeAccessory(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('accId') accId: string,
  ): Promise<void> {
    const userId = this.requireUserId(authUser);
    const asset = await this.assets.getById(id, userId);

    if (asset.projectId) {
      const hasProjAccess = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_assets',
        object: `project:${asset.projectId}`,
      });
      if (!hasProjAccess) {
        throw new ForbiddenException('No tienes permisos para eliminar accesorios en este proyecto.');
      }
    } else {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: 'organization:gmt',
      });
      if (!isGlobalAdmin) {
        throw new ForbiddenException('No tienes permisos para gestionar activos globales.');
      }
    }

    await this.assets.removeAccessory(id, accId, userId);
  }

  /**
   * Obtiene la plantilla de checklist del activo.
   */
  @Get(':id/checklist/template')
  getChecklistTemplate(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ChecklistTemplateView> {
    const userId = this.requireUserId(authUser);
    return this.assets.getChecklistTemplate(id, userId);
  }

  /**
   * Modifica la plantilla de checklist del activo (fuerza revisión).
   */
  @Put(':id/checklist/template')
  async updateChecklistTemplate(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateChecklistTemplateDto,
  ): Promise<ChecklistTemplateView> {
    const userId = this.requireUserId(authUser);
    const asset = await this.assets.getById(id, userId);

    if (asset.projectId) {
      const hasProjAccess = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_assets',
        object: `project:${asset.projectId}`,
      });
      if (!hasProjAccess) {
        throw new ForbiddenException('No tienes permisos para configurar plantillas en este proyecto.');
      }
    } else {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: 'organization:gmt',
      });
      if (!isGlobalAdmin) {
        throw new ForbiddenException('No tienes permisos para gestionar plantillas de activos globales.');
      }
    }

    return this.assets.updateChecklistTemplate(id, userId, dto.name, dto.items);
  }

  /**
   * Aprueba o rechaza la plantilla de checklist.
   */
  @Post(':id/checklist/template/review')
  @HttpCode(200)
  async reviewChecklistTemplate(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: ReviewChecklistTemplateDto,
  ): Promise<ChecklistTemplateView> {
    const userId = this.requireUserId(authUser);
    const isGlobalAdmin = await this.fga.check({
      user: `user:${userId}`,
      relation: 'admin',
      object: 'organization:gmt',
    });
    if (!isGlobalAdmin) {
      throw new ForbiddenException('No tienes permisos para revisar plantillas de checklists.');
    }

    return this.assets.reviewChecklistTemplate(id, userId, dto.status, dto.reason);
  }

  /**
   * Envía las respuestas de un checklist ejecutado.
   */
  @Post(':id/checklist/submit')
  submitChecklist(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: SubmitChecklistDto,
  ): Promise<ChecklistSubmissionView> {
    const userId = this.requireUserId(authUser);
    return this.assets.submitChecklist(id, dto.templateId, userId, dto.answers);
  }

  /**
   * Obtiene el historial de envíos de checklist del activo.
   */
  @Get(':id/checklist/submissions')
  listChecklistSubmissions(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<ChecklistSubmissionView[]> {
    const userId = this.requireUserId(authUser);
    return this.assets.listChecklistSubmissions(id, userId);
  }

  /**
   * Genera y descarga un PDF con la plantilla + respuestas de una submission de
   * checklist. Lectura pura: la autorización (`asset:read` con respaldo
   * estructural por-activo) la resuelve el servicio. Responde `application/pdf`.
   */
  @Get(':id/checklist/submissions/:submissionId/pdf')
  async getChecklistSubmissionPdf(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const userId = this.requireUserId(authUser);
    const pdf = await this.assets.generateChecklistSubmissionPdf(id, submissionId, userId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="checklist-${submissionId}.pdf"`);
    res.end(Buffer.from(pdf));
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }

  /**
   * Envía telemetría de ubicación y velocidad para un vehículo. La autorización
   * (funcional `asset:checklist:run:any` o el gate estructural del asignado) la
   * resuelve el servicio, igual que el envío de checklist.
   */
  @Post(':id/telemetry')
  submitTelemetry(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: SubmitTelemetryDto,
  ): Promise<AssetView> {
    const userId = this.requireUserId(authUser);
    return this.assets.updateTelemetry(id, userId, dto);
  }
}
