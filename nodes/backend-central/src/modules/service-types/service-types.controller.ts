import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { ServiceTypeView } from '@gmt-platform/contracts';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { CreateServiceTypeDto, UpdateServiceTypeDto } from './dto/service-type.dto';
import { ServiceTypesService } from './service-types.service';

/**
 * Catálogo org-level de tipos de servicio (Tanda 4). El LISTADO (`GET`) es de
 * lectura para cualquier autenticado (alimenta el selector al crear un servicio y
 * la página del catálogo). Las MUTACIONES exigen el permiso FUNCTIONAL org-scope
 * `service_type:manage` (org_admin / admin_ti lo reciben vía ALL_GLOBAL), chequeado
 * con `PermissionService.can` — mismo mecanismo que proveedores/bodegas.
 */
@Controller('service-types')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ServiceTypesController {
  constructor(
    private readonly service: ServiceTypesService,
    private readonly permissions: PermissionService,
  ) {}

  /** Lista los tipos. `?includeInactive=true` incluye los desactivados (catálogo admin). */
  @Get()
  list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<ServiceTypeView[]> {
    this.requireUserId(user);
    return this.service.list(includeInactive === 'true');
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CreateServiceTypeDto,
  ): Promise<ServiceTypeView> {
    await this.requireManage(this.requireUserId(user));
    return this.service.create(dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateServiceTypeDto,
  ): Promise<ServiceTypeView> {
    await this.requireManage(this.requireUserId(user));
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string): Promise<void> {
    await this.requireManage(this.requireUserId(user));
    return this.service.remove(id);
  }

  /** Gate de gestión del catálogo (`service_type:manage`, FUNCTIONAL org-scope). */
  private async requireManage(userId: string): Promise<void> {
    const decision = await this.permissions.can(userId, 'service_type:manage');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para gestionar tipos de servicio.');
    }
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }
}
