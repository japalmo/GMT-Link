import { Body, Controller, Get, Param, Post, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CreateWarehouseDto, RegisterTransactionDto } from './dto/supplies.dto';
import { SuppliesService } from './supplies.service';
import { WarehouseStockView, WarehouseTransactionView, WarehouseView } from './supplies.types';

@Controller('warehouses')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class WarehousesController {
  constructor(private readonly service: SuppliesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateWarehouseDto): Promise<WarehouseView> {
    this.requireUser(user);
    return this.service.createWarehouse(dto);
  }

  @Get()
  list(): Promise<WarehouseView[]> {
    return this.service.listWarehouses();
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
  ): Promise<{
    warehouse: WarehouseView;
    stocks: WarehouseStockView[];
    transactions: WarehouseTransactionView[];
  }> {
    return this.service.getWarehouseById(id);
  }

  @Post(':id/transactions')
  registerTransaction(
    @Param('id') warehouseId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: RegisterTransactionDto,
  ): Promise<WarehouseTransactionView> {
    const actorId = this.requireUserId(user);
    return this.service.registerTransaction(warehouseId, actorId, dto);
  }

  private requireUser(user: AuthUser | undefined): void {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }
}
