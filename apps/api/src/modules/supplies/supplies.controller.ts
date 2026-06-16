import { Body, Controller, Get, Post, Query, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CreateSupplyDto, ImportSuppliesDto } from './dto/supplies.dto';
import { SuppliesService } from './supplies.service';
import { SupplyView } from './supplies.types';

@Controller('supplies')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SuppliesController {
  constructor(private readonly service: SuppliesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateSupplyDto): Promise<SupplyView> {
    this.requireUser(user);
    return this.service.createSupply(dto);
  }

  @Get()
  list(@Query('search') search?: string, @Query('category') category?: string): Promise<SupplyView[]> {
    return this.service.listSupplies(search, category);
  }

  @Post('import')
  import(@CurrentUser() user: AuthUser | undefined, @Body() dto: ImportSuppliesDto): Promise<{ count: number }> {
    const actorId = this.requireUserId(user);
    return this.service.importSupplies(actorId, dto);
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
