import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientView } from './clients.types';

@Controller('clients')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Crea un cliente. Gateado con el permiso FUNCTIONAL 'client:create'.
   */
  @Post()
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateClientDto,
  ) {
    const userId = this.requireUserId(authUser);

    const decision = await this.permissions.can(userId, 'client:create');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para crear clientes.');
    }

    return this.clients.create(dto);
  }

  /**
   * Lista los clientes con métricas por cliente (proyectos, activos, alertas pendientes).
   */
  @Get()
  listAll(@CurrentUser() authUser: AuthUser | undefined): Promise<ClientView[]> {
    this.requireUserId(authUser);
    return this.clients.listAll();
  }

  /**
   * Detalle de un cliente.
   */
  @Get(':id')
  getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    this.requireUserId(authUser);
    return this.clients.getById(id);
  }

  /**
   * Actualiza los campos editables de un cliente (name, rut).
   */
  @Patch(':id')
  async update(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    const userId = this.requireUserId(authUser);

    const decision = await this.permissions.can(userId, 'client:create');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para modificar clientes.');
    }

    return this.clients.update(id, dto);
  }

  /**
   * Elimina un cliente. Bloquea si tiene faenas o proyectos asociados (409).
   * Gateado con el permiso FUNCTIONAL 'client:create'.
   */
  @Delete(':id')
  async remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);

    const decision = await this.permissions.can(userId, 'client:create');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para eliminar clientes.');
    }

    return this.clients.remove(id);
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
