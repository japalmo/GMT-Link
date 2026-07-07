import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { CreateWarehouseDto, RegisterTransactionDto } from './dto/supplies.dto';
import { SuppliesService } from './supplies.service';
import { WarehouseStockView, WarehouseTransactionView, WarehouseView } from './supplies.types';

/**
 * Subsección Bodegas: acceso protegido por el permiso FUNCTIONAL org-scope
 * `warehouse:access` (spec: "subsección con permiso especial"). Cada ruta se
 * gatea con `PermissionService.can` — mismo mecanismo que clients/faenas usan
 * para sus permisos FUNCTIONAL. Un usuario sin la clave (p. ej. worker por
 * defecto) recibe 403; org_admin, department_admin y roles custom con la clave, 200.
 */
@Controller('warehouses')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class WarehousesController {
  constructor(
    private readonly service: SuppliesService,
    private readonly permissions: PermissionService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateWarehouseDto): Promise<WarehouseView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.createWarehouse(dto);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser | undefined): Promise<WarehouseView[]> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.listWarehouses();
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{
    warehouse: WarehouseView;
    stocks: WarehouseStockView[];
    transactions: WarehouseTransactionView[];
  }> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.getWarehouseById(id);
  }

  @Post(':id/transactions')
  async registerTransaction(
    @Param('id') warehouseId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: RegisterTransactionDto,
  ): Promise<WarehouseTransactionView> {
    const actorId = this.requireUserId(user);
    await this.requireAccess(actorId);
    return this.service.registerTransaction(warehouseId, actorId, dto);
  }

  /**
   * Gate de la subsección Bodegas vía la fachada `PermissionService`.
   * `warehouse:access` es FUNCTIONAL org-scope (scopeable:false → siempre GLOBAL),
   * así que se decide con `can(...)` sin recurso, igual que `client:create`.
   */
  private async requireAccess(userId: string): Promise<void> {
    const decision = await this.permissions.can(userId, 'warehouse:access');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para acceder a Bodegas.');
    }
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }
}
