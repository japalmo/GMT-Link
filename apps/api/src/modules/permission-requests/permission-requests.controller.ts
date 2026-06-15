import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { ORG_ID } from '../../common/org.constant';
import { CreatePermissionRequestDto } from './dto/create-permission-request.dto';
import { RejectPermissionRequestDto } from './dto/reject-permission-request.dto';
import { PermissionRequestsService } from './permission-requests.service';
import type {
  PermissionRequestAdminView,
  PermissionRequestView,
} from './permission-requests.types';

/**
 * Solicitudes de permisos/rol a un admin (§6-2.3).
 *
 * Rutas del SOLICITANTE (autenticadas, operan sobre lo propio por userId de
 * sesión): crear y listar las propias. Rutas del ADMIN (gateadas por OpenFGA
 * `can_manage_users` sobre `organization:gmt`, recurso de id estático): listar
 * pendientes, aprobar, rechazar. El `ValidationPipe` rechaza campos extra.
 */
@Controller('permission-requests')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class PermissionRequestsController {
  constructor(private readonly service: PermissionRequestsService) {}

  /** Crea una solicitud propia (scope organización). 400 rol inválido; 409 duplicada. */
  @Post()
  create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreatePermissionRequestDto,
  ): Promise<PermissionRequestView> {
    return this.service.create(this.requireUserId(authUser), dto);
  }

  /** Solicitudes propias (createdAt desc). */
  @Get('me')
  listMine(@CurrentUser() authUser: AuthUser | undefined): Promise<PermissionRequestView[]> {
    return this.service.listMine(this.requireUserId(authUser));
  }

  /** [ADMIN] Solicitudes PENDIENTES de todos, con datos del solicitante. */
  @Get()
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  listPending(): Promise<PermissionRequestAdminView[]> {
    return this.service.listPending();
  }

  /** [ADMIN] Aprueba una solicitud PENDIENTE y aplica el rol. 404 / 409 según estado. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<PermissionRequestView> {
    return this.service.approve(this.requireUserId(authUser), id);
  }

  /** [ADMIN] Rechaza una solicitud PENDIENTE (motivo opcional). 404 / 409 según estado. */
  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectPermissionRequestDto,
  ): Promise<PermissionRequestView> {
    return this.service.reject(this.requireUserId(authUser), id, dto.reason);
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
