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
import { AddProviderProductDto, CleanProviderDataDto, CreateProviderDto, SubmitProviderRatingDto } from './dto/providers.dto';
import { ProvidersService } from './providers.service';
import { ProviderProductView, ProviderRatingView, ProviderView } from './providers.types';

/**
 * Subsección Proveedores: acceso protegido por el permiso FUNCTIONAL org-scope
 * `provider:access` (spec: "subsección con permiso especial"). Cada ruta se
 * gatea con `PermissionService.can` — mismo mecanismo que clients/faenas usan
 * para sus permisos FUNCTIONAL. Un usuario sin la clave (p. ej. worker por
 * defecto) recibe 403; org_admin, department_admin y roles custom con la clave, 200.
 */
@Controller('providers')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ProvidersController {
  constructor(
    private readonly service: ProvidersService,
    private readonly permissions: PermissionService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateProviderDto): Promise<ProviderView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.createProvider(dto);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser | undefined): Promise<ProviderView[]> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.listProviders();
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{
    provider: ProviderView;
    products: ProviderProductView[];
    ratings: ProviderRatingView[];
  }> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.getProviderById(id);
  }

  @Post(':id/products')
  async addProduct(
    @Param('id') providerId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: AddProviderProductDto,
  ): Promise<ProviderProductView> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.addProduct(providerId, dto);
  }

  @Post(':id/ratings')
  async submitRating(
    @Param('id') providerId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: SubmitProviderRatingDto,
  ): Promise<ProviderRatingView> {
    const actorId = this.requireUserId(user);
    await this.requireAccess(actorId);
    return this.service.submitRating(providerId, actorId, dto);
  }

  @Post('clean-data')
  async cleanData(
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: CleanProviderDataDto,
  ): Promise<{
    name: string;
    rut?: string;
    email?: string;
    phone?: string;
    address?: string;
    products: Array<{ name: string; description?: string; price?: number; unit?: string }>;
  }> {
    const userId = this.requireUserId(user);
    await this.requireAccess(userId);
    return this.service.cleanProviderData(userId, dto.rawData);
  }

  /**
   * Gate de la subsección Proveedores vía la fachada `PermissionService`.
   * `provider:access` es FUNCTIONAL org-scope (scopeable:false → siempre GLOBAL),
   * así que se decide con `can(...)` sin recurso, igual que `client:create`.
   */
  private async requireAccess(userId: string): Promise<void> {
    const decision = await this.permissions.can(userId, 'provider:access');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para acceder a Proveedores.');
    }
  }

  private requireUserId(user: AuthUser | undefined): string {
    if (!user) {
      throw new UnauthorizedException('Debe iniciar sesión para realizar esta acción.');
    }
    return user.id;
  }
}
