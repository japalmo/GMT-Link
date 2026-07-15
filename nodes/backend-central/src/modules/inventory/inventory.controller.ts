import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type {
  InventoryCatalogItem,
  InventoryImportResult,
  InventoryItemDetail,
  InventoryItemView,
  SupplyAssignmentView,
  SupplyProviderLinkView,
  SupplyRequestView,
  TablePage,
  TableRequest,
} from '@gmt-platform/contracts';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import {
  CreateInventoryItemDto,
  CreateMyRequestDto,
  DeliverRequestDto,
  ImportInventoryDto,
  LinkProviderDto,
  RejectRequestDto,
  UpdateInventoryItemDto,
  UpdateProviderLinkDto,
} from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

/**
 * Módulo Inventario (catálogo de artículos + solicitudes de insumos).
 *
 * Gate: el catálogo, el import, los proveedores por artículo y la GESTIÓN de
 * solicitudes exigen el permiso FUNCTIONAL org-scope `inventory:access`
 * (admins/gerencia/logística), decidido inline con `PermissionService.can`,
 * el mismo mecanismo que `warehouse:access` en supplies/warehouses.
 *
 * Las rutas `/inventory/me/*` son PROPIAS (patrón documents/me): el `userId`
 * sale SIEMPRE de la sesión. El catálogo liviano y las solicitudes propias
 * (`me/catalog`, `me/requests`) exigen el derecho base `inventory:request:own`
 * (roles internos; los externos como client_ito quedan fuera). `me/assignments`
 * es el comprobante propio y queda solo-sesión.
 *
 * Los literales `items/table`, `items/import` y `requests/table` se declaran
 * antes que sus rutas con `:id` para que el segmento estático no lo capture el
 * parámetro.
 */
@Controller('inventory')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly permissions: PermissionService,
  ) {}

  // ============ Catálogo de artículos (gate inventory:access) ============

  /** Catálogo con el MOTOR de tablas server-side (búsqueda/filtro/orden/paginación). */
  @Get('items/table')
  async listItemsTable(
    @CurrentUser() user: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<TablePage<InventoryItemView>> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      search,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters: filters && typeof filters === 'object' ? filters : undefined,
    };
    return this.service.listItemsTable(req);
  }

  /** Crea un artículo individual (sin stock). 409 si el código ya existe. */
  @Post('items')
  async createItem(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CreateInventoryItemDto,
  ): Promise<InventoryItemView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.createItem(dto);
  }

  /**
   * Import masivo por CSV: upsert por code + stock inicial opcional en hasta 4
   * bodegas (por código de bodega). Errores por fila sin abortar el lote.
   */
  @Post('items/import')
  async importItems(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: ImportInventoryDto,
  ): Promise<InventoryImportResult> {
    const actorId = this.requireUserId(user);
    await this.requireAccess(actorId);
    return this.service.importItems(actorId, dto);
  }

  /** Detalle de un artículo: stocks por bodega + total + proveedores. */
  @Get('items/:id')
  async getItem(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<InventoryItemDetail> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.getItemDetail(id);
  }

  /** Edita los campos descriptivos de un artículo. */
  @Patch('items/:id')
  async updateItem(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
  ): Promise<InventoryItemView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.updateItem(id, dto);
  }

  // ============ Proveedores por artículo (gate inventory:access) ============

  /** Vincula un proveedor al artículo (precio CLP + URL opcionales). 409 si ya está vinculado. */
  @Post('items/:id/providers')
  async linkProvider(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: LinkProviderDto,
  ): Promise<SupplyProviderLinkView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.linkProvider(id, dto);
  }

  /** Edita el precio/URL de un vínculo artículo-proveedor. */
  @Patch('items/:id/providers/:linkId')
  async updateProviderLink(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() dto: UpdateProviderLinkDto,
  ): Promise<SupplyProviderLinkView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.updateProviderLink(id, linkId, dto);
  }

  /** Desvincula un proveedor del artículo. */
  @Delete('items/:id/providers/:linkId')
  async unlinkProvider(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<{ ok: true }> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.unlinkProvider(id, linkId);
  }

  // ============ Solicitudes de insumos: gestión (gate inventory:access) ============

  /** TODAS las solicitudes con el MOTOR de tablas (filtro por estado). */
  @Get('requests/table')
  async listRequestsTable(
    @CurrentUser() user: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<TablePage<SupplyRequestView>> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters: filters && typeof filters === 'object' ? filters : undefined,
    };
    return this.service.listRequestsTable(req);
  }

  /** ENTREGA una solicitud descontando stock de la bodega indicada. 409 si no está pendiente. */
  @Post('requests/:id/deliver')
  async deliverRequest(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: DeliverRequestDto,
  ): Promise<SupplyRequestView> {
    const actorId = this.requireUserId(user);
    await this.requireAccess(actorId);
    return this.service.deliverRequest(id, actorId, dto);
  }

  /** RECHAZA una solicitud con motivo opcional. 409 si no está pendiente. */
  @Post('requests/:id/reject')
  async rejectRequest(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
  ): Promise<SupplyRequestView> {
    const actorId = this.requireUserId(user);
    await this.requireAccess(actorId);
    return this.service.rejectRequest(id, actorId, dto);
  }

  /**
   * Historial COMPLETO de entregas con el MOTOR de tablas: búsqueda por nombre
   * del artículo o del trabajador, orden por fecha/cantidad. Cada fila incluye
   * al trabajador receptor (`worker`). Gate `inventory:access`.
   */
  @Get('assignments/table')
  async listAssignmentsTable(
    @CurrentUser() user: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ): Promise<TablePage<SupplyAssignmentView>> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      search,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
    };
    return this.service.listAssignmentsTable(req);
  }

  // ============ Rutas propias (userId SIEMPRE de la sesión) ============

  /**
   * Catálogo LIVIANO para armar la solicitud de insumos: forma mínima
   * (id/code/name/unit/category), sin stock ni precios. Gate `inventory:request:own`
   * (derecho base de los roles internos; deja fuera a externos como client_ito).
   */
  @Get('me/catalog')
  async listCatalog(@CurrentUser() user: AuthUser | undefined): Promise<InventoryCatalogItem[]> {
    const userId = this.requireUserId(user);
    await this.requireRequestOwn(userId);
    return this.service.listCatalog();
  }

  /**
   * Mis artículos entregados (nombre, cantidad, fecha y quién entregó). Es el
   * comprobante PROPIO del usuario: solo sesión, sin permiso especial (un
   * externo simplemente no tiene entregas).
   */
  @Get('me/assignments')
  async listMyAssignments(
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<SupplyAssignmentView[]> {
    return this.service.listMyAssignments(this.requireUserId(user));
  }

  /** Mis solicitudes de insumos con estado e ítems. Gate `inventory:request:own`. */
  @Get('me/requests')
  async listMyRequests(@CurrentUser() user: AuthUser | undefined): Promise<SupplyRequestView[]> {
    const userId = this.requireUserId(user);
    await this.requireRequestOwn(userId);
    return this.service.listMyRequests(userId);
  }

  /**
   * Crea una solicitud de insumos propia (mínimo 1 ítem; artículos validados).
   * Gate `inventory:request:own`.
   */
  @Post('me/requests')
  async createMyRequest(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CreateMyRequestDto,
  ): Promise<SupplyRequestView> {
    const userId = this.requireUserId(user);
    await this.requireRequestOwn(userId);
    return this.service.createMyRequest(userId, dto);
  }

  /**
   * Gate del módulo Inventario vía la fachada `PermissionService`.
   * `inventory:access` es FUNCTIONAL org-scope (scopeable:false → siempre GLOBAL),
   * así que se decide con `can(...)` sin recurso, igual que `warehouse:access`.
   */
  private async requireAccess(userId: string): Promise<void> {
    const decision = await this.permissions.can(userId, 'inventory:access');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para acceder a Inventario.');
    }
  }

  /**
   * Gate de las rutas propias de solicitud (`me/catalog`, `me/requests`):
   * `inventory:request:own` es el derecho BASE de los roles internos (espejo de
   * `finance:request:create`). FUNCTIONAL org-scope, se decide con `can(...)`.
   */
  private async requireRequestOwn(userId: string): Promise<void> {
    const decision = await this.permissions.can(userId, 'inventory:request:own');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para solicitar insumos.');
    }
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }
}
