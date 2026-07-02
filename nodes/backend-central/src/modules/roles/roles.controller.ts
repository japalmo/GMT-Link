import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { CloneRoleResponse, PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';
import { ORG_ID } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CloneRoleDto } from './dto/clone-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

/**
 * CRUD de roles dinámicos (RBAC dinámico, Fase 2). TODOS los endpoints exigen
 * `can_manage_roles` sobre `organization:gmt` (recurso estático, igual que
 * `UsersController` con `can_manage_users`, §3.1).
 */
@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /** Catálogo de permisos agrupado por módulo (para pintar la matriz). */
  @Get('permissions')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  listPermissions(): Promise<PermissionCatalogGroup[]> {
    return this.rolesService.listPermissions();
  }

  /** Todos los roles (sistema + custom). */
  @Get('roles')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  listRoles(): Promise<RoleDetail[]> {
    return this.rolesService.listRoles();
  }

  /** Detalle de un rol. */
  @Get('roles/:key')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  getRole(@Param('key') key: string): Promise<RoleDetail> {
    return this.rolesService.getRole(key);
  }

  /** Crea un rol custom (grants: [] es válido, A6) atribuido al admin autenticado. */
  @Post('roles')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  async createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() authUser: AuthUser | undefined,
  ): Promise<RoleDetail> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return this.rolesService.createRole(dto, authUser.id);
  }

  /** Actualiza label/description/grants de un rol custom. 403 si es del sistema. */
  @Patch('roles/:key')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  updateRole(@Param('key') key: string, @Body() dto: UpdateRoleDto): Promise<RoleDetail> {
    return this.rolesService.updateRole(key, dto);
  }

  /** Elimina un rol custom. 403 si es del sistema; 409 si está en uso. */
  @Delete('roles/:key')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  deleteRole(@Param('key') key: string): Promise<void> {
    return this.rolesService.deleteRole(key);
  }

  /**
   * Clona un rol (sistema o custom); devuelve el rol nuevo + permisos omitidos
   * (A7). El clon queda atribuido (`createdById`) al admin autenticado que
   * clona — nunca hereda la atribución del rol origen.
   */
  @Post('roles/:key/clone')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  async cloneRole(
    @Param('key') key: string,
    @Body() dto: CloneRoleDto,
    @CurrentUser() authUser: AuthUser | undefined,
  ): Promise<CloneRoleResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return this.rolesService.cloneRole(key, dto.label, authUser.id);
  }
}
