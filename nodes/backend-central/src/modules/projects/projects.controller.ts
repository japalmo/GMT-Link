import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { FgaService } from '../../fga/fga.service';
import { ProjectsService } from './projects.service';
import {
  CreateAssignmentDto,
  CreateProjectDto,
  CreateServiceDto,
  UpdateAssignmentDto,
  UpdateProjectKpisDto,
  UpdateServiceFrequencyDto,
} from './dto/projects.dto';

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
   * Filtra opcionalmente por faena (`?faenaId=`).
   */
  @Get()
  listAll(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('faenaId') faenaId?: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.projects.listAll(userId, faenaId);
  }

  /**
   * Lista los usuarios internos elegibles como administrador de proyecto
   * (para el selector del formulario de creación de proyecto).
   */
  @Get('eligible-admins')
  listEligibleAdmins(@CurrentUser() authUser: AuthUser | undefined) {
    this.requireUserId(authUser);
    return this.projects.listEligibleAdmins();
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

  /**
   * Setea la frecuencia de un servicio del proyecto.
   * Gate: can_define_kpi (project_creator/admin) — misma gestión de configuración
   * del proyecto que KPIs/servicios.
   */
  @Patch(':id/services/:sid')
  @RequirePermission('can_define_kpi', { type: 'project', param: 'id' })
  setServiceFrequency(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Body() dto: UpdateServiceFrequencyDto,
  ) {
    this.requireUserId(authUser);
    return this.projects.setServiceFrequency(id, sid, dto);
  }

  // ── Asignación de trabajadores (project:team:manage → can_manage_team) ──────

  @Get(':id/assignments')
  @RequirePermission('can_manage_team', { type: 'project', param: 'id' })
  listAssignments(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    this.requireUserId(authUser);
    return this.projects.listAssignments(id);
  }

  @Post(':id/assignments')
  @RequirePermission('can_manage_team', { type: 'project', param: 'id' })
  createAssignment(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    this.requireUserId(authUser);
    return this.projects.createAssignment(id, dto);
  }

  @Patch(':id/assignments/:aid')
  @RequirePermission('can_manage_team', { type: 'project', param: 'id' })
  updateAssignment(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('aid') aid: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    this.requireUserId(authUser);
    return this.projects.updateAssignment(id, aid, dto);
  }

  @Delete(':id/assignments/:aid')
  @RequirePermission('can_manage_team', { type: 'project', param: 'id' })
  removeAssignment(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('aid') aid: string,
  ) {
    this.requireUserId(authUser);
    return this.projects.removeAssignment(id, aid);
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
