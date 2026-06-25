import { Body, Controller, Get, Param, Post, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { AddProviderProductDto, CleanProviderDataDto, CreateProviderDto, SubmitProviderRatingDto } from './dto/providers.dto';
import { ProvidersService } from './providers.service';
import { ProviderProductView, ProviderRatingView, ProviderView } from './providers.types';

@Controller('providers')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ProvidersController {
  constructor(private readonly service: ProvidersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateProviderDto): Promise<ProviderView> {
    this.requireUser(user);
    return this.service.createProvider(dto);
  }

  @Get()
  list(): Promise<ProviderView[]> {
    return this.service.listProviders();
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
  ): Promise<{
    provider: ProviderView;
    products: ProviderProductView[];
    ratings: ProviderRatingView[];
  }> {
    return this.service.getProviderById(id);
  }

  @Post(':id/products')
  addProduct(
    @Param('id') providerId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: AddProviderProductDto,
  ): Promise<ProviderProductView> {
    this.requireUser(user);
    return this.service.addProduct(providerId, dto);
  }

  @Post(':id/ratings')
  submitRating(
    @Param('id') providerId: string,
    @CurrentUser() user: AuthUser | undefined,
    @Body() dto: SubmitProviderRatingDto,
  ): Promise<ProviderRatingView> {
    const actorId = this.requireUserId(user);
    return this.service.submitRating(providerId, actorId, dto);
  }

  @Post('clean-data')
  cleanData(
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
    return this.service.cleanProviderData(userId, dto.rawData);
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
