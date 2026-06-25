import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { ListNotificationsQueryDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';
import type { NotificationView } from './notifications.types';

/**
 * Notificaciones in-app (§6-2.2). Todas las rutas son AUTENTICADAS y operan
 * SOLO sobre las notificaciones del usuario de la sesión: el `userId` se deriva
 * de `request.authUser`, nunca del body/query. Marcar una ajena devuelve 404.
 */
@Controller('notifications')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** Lista las notificaciones propias (createdAt desc). `?unreadOnly=true` filtra no leídas. */
  @Get()
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationView[]> {
    return this.notificationsService.listMine(this.requireUserId(authUser), query.unreadOnly === 'true');
  }

  /** Cantidad de notificaciones propias sin leer. */
  @Get('unread-count')
  unreadCount(@CurrentUser() authUser: AuthUser | undefined): Promise<{ count: number }> {
    return this.notificationsService.unreadCount(this.requireUserId(authUser));
  }

  /** Marca como leída una notificación propia. 404 si no existe o es ajena. */
  @Post(':id/read')
  markRead(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<NotificationView> {
    return this.notificationsService.markRead(this.requireUserId(authUser), id);
  }

  /** Marca como leídas todas las no leídas del usuario. Retorna cuántas se actualizaron. */
  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() authUser: AuthUser | undefined): Promise<{ updated: number }> {
    return this.notificationsService.markAllRead(this.requireUserId(authUser));
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
