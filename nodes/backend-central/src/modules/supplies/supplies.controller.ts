import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { CreateSupplyDto, ImportSuppliesDto } from './dto/supplies.dto';
import { SuppliesService } from './supplies.service';
import { SupplyView } from './supplies.types';

/**
 * Catálogo de Insumos de la subsección Bodegas. Comparte el gate FUNCTIONAL
 * org-scope `warehouse:access` con las bodegas (spec: "subsección con permiso
 * especial"). Cada ruta se gatea con `PermissionService.can` — mismo mecanismo
 * que clients/faenas. Sin la clave (worker por defecto) → 403.
 */
@Controller('supplies')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SuppliesController {
  constructor(
    private readonly service: SuppliesService,
    private readonly permissions: PermissionService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateSupplyDto): Promise<SupplyView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.createSupply(dto);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ): Promise<SupplyView[]> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.listSupplies(search, category);
  }

  @Post('import')
  async import(@CurrentUser() user: AuthUser | undefined, @Body() dto: ImportSuppliesDto): Promise<{ count: number }> {
    const actorId = this.requireUserId(user);
    await this.requireAccess(actorId);
    return this.service.importSupplies(actorId, dto);
  }

  /**
   * Gate de la subsección Insumos/Bodegas vía la fachada `PermissionService`.
   * `warehouse:access` es FUNCTIONAL org-scope (scopeable:false → siempre GLOBAL).
   */
  private async requireAccess(userId: string): Promise<void> {
    const decision = await this.permissions.can(userId, 'warehouse:access');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para acceder a Bodegas/Insumos.');
    }
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }
}
