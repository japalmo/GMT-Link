import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { FgaService } from '../../fga/fga.service';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, CreateServiceDto, UpdateProjectKpisDto } from './dto/projects.dto';

@Controller('projects')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly fga: FgaService,
  ) {}

  /**
   * Crea un proyecto.
   * Valida manualmente que el usuario sea admin en el departamento (ej. department_admin o global org_admin).
   */
  @Post()
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateProjectDto,
  ) {
    const userId = this.requireUserId(authUser);

    // Verificar permiso FGA
    const isDepartmentAdmin = await this.fga.check({
      user: `user:${userId}`,
      relation: 'admin',
      object: `department:${dto.departmentId}`,
    });

    if (!isDepartmentAdmin) {
      throw new ForbiddenException(
        'No tienes permiso para crear proyectos en este departamento.',
      );
    }

    return this.projects.create(userId, dto);
  }

  /**
   * Lista todos los proyectos a los que el usuario tiene acceso.
   */
  @Get()
  listAll(@CurrentUser() authUser: AuthUser | undefined) {
    const userId = this.requireUserId(authUser);
    return this.projects.listAll(userId);
  }

  /**
   * Obtiene todos los departamentos disponibles (para formularios).
   */
  @Get('departments')
  listDepartments() {
    return this.projects.listDepartments();
  }

  /**
   * Obtiene todos los clientes disponibles (para formularios).
   */
  @Get('clients')
  listClients() {
    return this.projects.listClients();
  }

  /**
   * Detalle de un proyecto.
   */
  @Get(':id')
  @RequirePermission('can_view', { type: 'project', param: 'id' })
  getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.projects.getById(id, userId);
  }

  /**
   * Agrega un servicio al proyecto.
   */
  @Post(':id/services')
  @RequirePermission('can_create_service', { type: 'project', param: 'id' })
  createService(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: CreateServiceDto,
  ) {
    const userId = this.requireUserId(authUser);
    return this.projects.createService(id, dto, userId);
  }

  /**
   * Configura los KPIs del proyecto (JSONB).
   */
  @Put(':id/kpis')
  @RequirePermission('can_define_kpi', { type: 'project', param: 'id' })
  updateKpis(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateProjectKpisDto,
  ) {
    const userId = this.requireUserId(authUser);
    return this.projects.updateKpis(id, dto, userId);
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
