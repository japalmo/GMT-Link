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
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { FaenasService } from './faenas.service';
import { CreateFaenaDto, UpdateFaenaDto } from './dto/faenas.dto';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class FaenasController {
  constructor(
    private readonly faenas: FaenasService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Crea una faena para un cliente.
   * Gate: permiso FUNCTIONAL `faena:create` (org-scope, siempre GLOBAL).
   */
  @Post('clients/:id/faenas')
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') clientId: string,
    @Body() dto: CreateFaenaDto,
  ) {
    const userId = this.requireUserId(authUser);
    await this.requireFunctional(userId, 'faena:create');
    return this.faenas.create(clientId, dto);
  }

  /**
   * Lista las faenas de un cliente con métricas por faena (nº proyectos,
   * proyectos activos, alertas).
   */
  @Get('clients/:id/faenas')
  listByClient(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') clientId: string,
  ) {
    // Lectura abierta a cualquier usuario autenticado: la navegación
    // Cliente→Faena→Proyecto es para todos; solo la CREACIÓN se gatea.
    this.requireUserId(authUser);
    return this.faenas.listByClient(clientId);
  }

  /** Detalle de una faena. */
  @Get('faenas/:id')
  getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    this.requireUserId(authUser);
    return this.faenas.getById(id);
  }

  /** Actualiza una faena. */
  @Patch('faenas/:id')
  async update(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateFaenaDto,
  ) {
    const userId = this.requireUserId(authUser);
    await this.requireFunctional(userId, 'faena:create');
    return this.faenas.update(id, dto);
  }

  /**
   * Elimina una faena. Se bloquea con 409 si tiene proyectos asociados.
   * Gate: mismo permiso FUNCTIONAL `faena:create` que la actualización.
   */
  @Delete('faenas/:id')
  @HttpCode(204)
  async remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    await this.requireFunctional(userId, 'faena:create');
    await this.faenas.remove(id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }

  /**
   * Gate de un permiso FUNCTIONAL org-scope vía la fachada `PermissionService`.
   * `@RequirePermission` solo cubre relaciones STRUCTURAL FGA; `faena:create`
   * es FUNCTIONAL (filtro de datos), así que se decide con `can(...)`.
   */
  private async requireFunctional(userId: string, permissionKey: string): Promise<void> {
    const decision = await this.permissions.can(userId, permissionKey);
    if (decision.effect !== 'allow') {
      throw new ForbiddenException(`No tienes el permiso "${permissionKey}".`);
    }
  }
}
