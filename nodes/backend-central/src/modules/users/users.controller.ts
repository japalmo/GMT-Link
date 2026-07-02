import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  Query,
  UsePipes,
  ValidationPipe,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ORG_ID } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { AssignRoleScopedDto } from './dto/assign-role-scoped.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ImportUsersDto } from './dto/import-users.dto';
import { UsersService } from './users.service';
import type { AssignRoleInput, ScopeType } from '@gmt-platform/contracts';
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

  /**
   * Asigna un rol (sistema o custom) a un usuario en un scope arbitrario
   * (§ Fase 3 matriz RBAC). Retro-compat: si el body omite `scopeType`/`scopeId`
   * (contrato legacy `{ roleKey }` que aún envía `roles-dialog.tsx` hasta la
   * Fase 5), el rol se asigna org-scope (ORGANIZATION/ORG_ID) como antes.
   * Devuelve la `UserRolesResponse` extendida (roleKeys + memberships).
   */
  @Post(':id/roles')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  assignRoleScoped(
    @Param('id') id: string,
    @Body() dto: AssignRoleScopedDto,
  ): Promise<UserRolesResponse> {
    return this.usersService.assignRoleScoped(id, this.resolveScopedInput(dto.roleKey, dto.scopeType, dto.scopeId));
  }

  /**
   * Quita un rol (sistema o custom) de un usuario en un scope arbitrario, vía
   * querystring. Retro-compat: si `scopeType`/`scopeId` faltan en la query,
   * resuelve a ORGANIZATION/ORG_ID.
   */
  @Delete(':id/roles')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  removeRoleScoped(
    @Param('id') id: string,
    @Query('roleKey') roleKey: string,
    @Query('scopeType') scopeType?: ScopeType,
    @Query('scopeId') scopeId?: string,
  ): Promise<UserRolesResponse> {
    return this.usersService.removeRoleScoped(id, this.resolveScopedInput(roleKey, scopeType, scopeId));
  }

  /**
   * Quita un rol org-scope de un usuario (endpoint legacy con `:roleKey` en el
   * path). Se conserva porque `roles-dialog.tsx` lo sigue usando hasta la
   * Fase 5; su path (`/roles/:roleKey`) NO colisiona con `/roles`. Resuelve el
   * scope a ORGANIZATION/ORG_ID y delega en el mismo camino scoped.
   */
  @Delete(':id/roles/:roleKey')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  removeRole(
    @Param('id') id: string,
    @Param('roleKey') roleKey: string,
  ): Promise<UserRolesResponse> {
    return this.usersService.removeRoleScoped(id, this.resolveScopedInput(roleKey));
  }

  /** Completa un scope parcial con el default org (ORGANIZATION/ORG_ID) para el `AssignRoleInput`. */
  private resolveScopedInput(
    roleKey: string,
    scopeType?: ScopeType,
    scopeId?: string,
  ): AssignRoleInput {
    return {
      roleKey,
      scopeType: scopeType ?? 'ORGANIZATION',
      scopeId: scopeId ?? ORG_ID,
    };
  }

  /** Sube la foto de avatar para un usuario. */
  @Patch(':id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UserListItem> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }

    const isSelf = authUser.id === id;
    const isAdmin = await this.usersService.checkAdminPermission(authUser.id);

    if (!isSelf && !isAdmin) {
      throw new ForbiddenException('No tienes permisos para modificar el avatar de este usuario.');
    }

    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file").');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('El archivo debe ser una imagen JPEG o PNG.');
    }

    return this.usersService.uploadAvatar(id, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }
}
