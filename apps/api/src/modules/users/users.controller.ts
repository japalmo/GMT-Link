import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ORG_ID } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ImportUsersDto } from './dto/import-users.dto';
import { UsersService } from './users.service';
import type {
  CreateUserResponse,
  ImportUsersResponse,
  UserListItem,
  UserRolesResponse,
} from './users.types';

/**
 * Provisión de usuarios por el admin (§1.1, §6-1.1).
 * TODOS los endpoints exigen `can_manage_users` sobre `organization:gmt`
 * (recurso de id ESTÁTICO, sin param de ruta): el guard lo resuelve contra
 * OpenFGA (§3.1). El `ValidationPipe` con `whitelist`+`forbidNonWhitelisted`
 * rechaza campos extra y transforma los DTO.
 */
@Controller('users')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Crea un usuario aprovisionado. Retorna la vista pública + la clave provisoria. */
  @Post()
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  create(@Body() dto: CreateUserDto): Promise<CreateUserResponse> {
    return this.usersService.create(dto);
  }

  /** Importa un lote de usuarios (máx 200). No aborta el lote por una fila mala. */
  @Post('import')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  importBatch(@Body() dto: ImportUsersDto): Promise<ImportUsersResponse> {
    return this.usersService.importBatch(dto.rows);
  }

  /** Lista usuarios con sus roleKeys (RoleScopedList). `?search=` opcional server-side. */
  @Get()
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  list(@Query('search') search?: string): Promise<UserListItem[]> {
    return this.usersService.list(search);
  }

  /** Detalle de un usuario. */
  @Get(':id')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  getById(@Param('id') id: string): Promise<UserListItem> {
    return this.usersService.getById(id);
  }

  /** Asigna un rol org-scope a un usuario. */
  @Post(':id/roles')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  assignRole(@Param('id') id: string, @Body() dto: AssignRoleDto): Promise<UserRolesResponse> {
    return this.usersService.assignRole(id, dto.roleKey);
  }

  /** Quita un rol org-scope de un usuario. */
  @Delete(':id/roles/:roleKey')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  removeRole(
    @Param('id') id: string,
    @Param('roleKey') roleKey: string,
  ): Promise<UserRolesResponse> {
    return this.usersService.removeRole(id, roleKey);
  }
}
