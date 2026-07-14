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
import { PermissionService } from '../../authz/permission.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { AssignRoleScopedDto } from './dto/assign-role-scoped.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ImportUsersDto } from './dto/import-users.dto';
import { ResendInviteDto } from './dto/resend-invite.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { UsersService } from './users.service';
import type {
  AssignRoleInput,
  ProjectAdminOption,
  ResendInvitePreview,
  ResendInviteResult,
  ScopeType,
  TablePage,
  TableRequest,
} from '@gmt-platform/contracts';
import type {
  CreateUserResponse,
  ImportUsersResponse,
  Paginated,
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
  constructor(
    private readonly usersService: UsersService,
    private readonly permissions: PermissionService,
  ) {}

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

  /**
   * Lista los usuarios (RoleScopedList) con paginación keyset. Devuelve una
   * página (`items` + `nextCursor`): el cliente pide la siguiente reenviando
   * `nextCursor` como `cursor`. `search` filtra server-side por nombre /
   * apellido / email / username.
   */
  @Get()
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  list(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<Paginated<UserListItem>> {
    return this.usersService.list({
      search,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  /**
   * Usuarios elegibles como administrador de proyecto: solo los que tienen un
   * rol que otorga `project:manage`. Para el select del formulario de proyecto.
   *
   * Escalada acotada: antes lo listaba cualquier autenticado (fuga de nombres +
   * roleKeys). Ahora se exige poder abrir el formulario de creación de proyecto.
   * Se acepta `project:create` O `project:manage` porque el gate del formulario
   * NO es uniforme: el backend crea con `project:create` (department_admin,
   * org_admin, admin_ti, gerencias beta) pero el front muestra el formulario con
   * `project:manage` (admin_contrato, gerencia_proyectos, org_admin, admin_ti).
   * Con solo `project:create` se quedarían sin dropdown admin_contrato y
   * gerencia_proyectos; la unión cubre a todos los que hoy abren el formulario.
   * DEBE declararse antes de `@Get(':id')` para no ser capturado por el param.
   */
  @Get('project-admins')
  async listProjectAdmins(
    @CurrentUser() authUser: AuthUser | undefined,
  ): Promise<ProjectAdminOption[]> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    const [canCreate, canManage] = await Promise.all([
      this.permissions.can(authUser.id, 'project:create'),
      this.permissions.can(authUser.id, 'project:manage'),
    ]);
    if (canCreate.effect !== 'allow' && canManage.effect !== 'allow') {
      throw new ForbiddenException('No tienes permisos para listar administradores de proyecto.');
    }
    return this.usersService.listProjectAdmins();
  }

  /**
   * Lista con el MOTOR de tablas server-side (offset): búsqueda, filtro y orden se
   * resuelven sobre el dataset completo y se devuelve una página numerada + total.
   * Lo consume la tabla del directorio (`useDataTable`). DEBE declararse antes de
   * `@Get(':id')` para que el segmento estático "table" no lo capture el param.
   */
  @Get('table')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  listTable(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<TablePage<UserListItem>> {
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      search,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters: filters && typeof filters === 'object' ? filters : undefined,
    };
    return this.usersService.listTable(req);
  }

  /** Detalle de un usuario. */
  @Get(':id')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  getById(@Param('id') id: string): Promise<UserListItem> {
    return this.usersService.getById(id);
  }

  /** Edita el detalle de un usuario (nombres, correos, usuario, cargo, tipo). */
  @Patch(':id')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  adminUpdate(@Param('id') id: string, @Body() dto: UpdateUserAdminDto): Promise<UserListItem> {
    return this.usersService.adminUpdate(id, dto);
  }

  /** Borra un usuario (hard delete; 409 si tiene registros asociados). */
  @Delete(':id')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  adminDelete(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return this.usersService.adminDelete(id, authUser.id);
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

  /**
   * Revoca todas las sesiones activas del usuario incrementando su época de sesión
   * (invalida sus JWT). Para forzar el cierre de sesión de una cuenta ACTIVA.
   */
  @Post(':id/revoke-sessions')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  revokeSessions(@Param('id') id: string): Promise<void> {
    return this.usersService.revokeSessions(id);
  }

  /** Revoca el acceso de un usuario (lo suspende e invalida sus tokens). */
  @Post(':id/revoke-invite')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  revokeInvite(@Param('id') id: string): Promise<UserListItem> {
    return this.usersService.revokeInvite(id);
  }

  /**
   * Vista previa del correo de reenvío de clave (sin efectos): asunto y mensaje por
   * defecto (editables), destinatario y si se puede enviar server-side. 409 si la
   * invitación ya fue usada. La clave NO se genera ni viaja aquí.
   */
  @Get(':id/resend-invite/preview')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  resendInvitePreview(@Param('id') id: string): Promise<ResendInvitePreview> {
    return this.usersService.resendInvitePreview(id);
  }

  /**
   * Reenvía la clave: regenera la clave provisoria y deja al usuario en
   * PENDING_FIRST_LOGIN. 409 si la invitación ya fue usada. Con `sendEmail` el
   * servidor envía el correo (asunto/mensaje editados, clave inyectada allí y NO
   * retornada); sin él, retorna la clave una vez para compartirla a mano.
   */
  @Post(':id/resend-invite')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  resendInvite(@Param('id') id: string, @Body() dto: ResendInviteDto): Promise<ResendInviteResult> {
    return this.usersService.resendInvite(id, dto);
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
