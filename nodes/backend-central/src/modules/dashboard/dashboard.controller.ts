import {
  Body,
  Controller,
  Get,
  Put,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { UpdateDashboardDto } from './dto/dashboard.dto';
import { DashboardService } from './dashboard.service';
import type { DashboardView } from './dashboard.types';

/**
 * Dashboard modular del usuario (§6-2.1). Rutas AUTENTICADAS sobre el dashboard
 * del propio usuario: el `userId` se deriva de la sesión, nunca del body. La
 * disponibilidad de cada widget se resuelve por permiso en el service (FGA).
 */
@Controller('dashboard')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Widgets disponibles + layout reconciliado del usuario. */
  @Get('me')
  getMine(@CurrentUser() authUser: AuthUser | undefined): Promise<DashboardView> {
    return this.dashboardService.getForUser(this.requireUserId(authUser));
  }

  /**
   * Guarda el layout del usuario (upsert). 400 si algún `widgetKey` no está
   * disponible. Retorna el mismo shape que GET (layout reconciliado).
   */
  @Put('me')
  updateMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpdateDashboardDto,
  ): Promise<DashboardView> {
    return this.dashboardService.updateForUser(this.requireUserId(authUser), dto.layout);
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
