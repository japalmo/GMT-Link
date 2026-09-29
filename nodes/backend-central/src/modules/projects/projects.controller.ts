import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Headers } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { ProjectsService } from './projects.service';
import { EditarAvanceActividadDto, EditarSemanaDto } from './dto/avance.dto';
import {
  CreateAssignmentDto,
  CreateProjectDto,
  CreateServiceDto,
  UpdateAssignmentDto,
  UpdateProjectDto,
  UpdateProjectKpisDto,
  UpdateServiceFrequencyDto,
  SetPublicPasswordDto,
  UnlockPublicDto,
} from './dto/projects.dto';

@Controller('projects')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Crea un proyecto.
   * Gate: permiso FUNCTIONAL `project:create` (org-scope, siempre GLOBAL). El
   * departamento ya no se pide en la creación, así que el gate deja de ser
   * department-scoped y pasa por la fachada `PermissionService` (org_admin /
   * admin_ti / department_admin lo tienen; las gerencias con beta:full también).
   */
  @Post()
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateProjectDto,
  ) {
    const userId = this.requireUserId(authUser);
    await this.requireFunctional(userId, 'project:create');
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
   * Dashboard PÚBLICO de avance de obra, sin sesión: es lo que se proyecta en la
   * TV de faena y el link que se comparte con el cliente.
   *
   * Va declarado ANTES de `@Get(':id')` a propósito: si quedara después, "public"
   * podría interpretarse como un id de proyecto. El token opaco es la única
   * credencial, igual que en la ficha pública de vehículos, y el servicio expone
   * solo avance físico, hitos y fechas.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } }) // 60/min por IP: la TV refresca sola
  @Get('public/:token/obra-dashboard')
  async getPublicObraDashboard(
    @Param('token') token: string,
    @Headers('x-obra-pase') pase?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    // Con sesión iniciada vale el permiso de siempre; sin sesión, el pase que
    // entrega la clave. Así el enlace protegido se abre de las dos formas que
    // pidió el negocio sin duplicar la regla de autorización.
    const sesionAutorizada = user
      ? await this.projects.puedeVerPorToken(token, user.id)
      : false;
    return this.projects.getPublicObraDashboard(token, { pase, sesionAutorizada });
  }

  /**
   * Canjea la clave del enlace público por un pase de jornada. Va MUY limitado
   * por IP: es el único punto donde se puede probar una clave.
   */
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('public/:token/unlock')
  unlockPublic(@Param('token') token: string, @Body() dto: UnlockPublicDto) {
    return this.projects.unlockPublicDashboard(token, dto.password);
  }

  /**
   * Fija o quita la clave del enlace público del proyecto. Exige el mismo
   * permiso que editar el proyecto: quien puede cambiar la obra puede decidir
   * quién ve su tablero.
   */
  @Patch(':id/public-password')
  @RequirePermission('can_edit', { type: 'project', param: 'id' })
  setPublicPassword(@Param('id') id: string, @Body() dto: SetPublicPasswordDto) {
    return this.projects.setPublicPassword(id, dto.password ?? null);
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
   * Dashboard de producción del proyecto (avance por servicio + curvas).
   * Mismo gate de visibilidad que el detalle (`can_view`).
   */
  @Get(':id/dashboard')
  @RequirePermission('can_view', { type: 'project', param: 'id' })
  getDashboard(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    this.requireUserId(authUser);
    return this.projects.getDashboard(id);
  }

  /**
   * Dashboard de avance de OBRA (avance físico por cantidad contra la carta
   * Gantt). Mismo gate de visibilidad que el detalle.
   */
  @Get(':id/obra-dashboard')
  @RequirePermission('can_view', { type: 'project', param: 'id' })
  getObraDashboard(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    this.requireUserId(authUser);
    return this.projects.getObraDashboard(id);
  }

  /**
   * Actualización GENERAL del proyecto (solo `name`/`description` en este corte).
   * Gate: permiso FUNCTIONAL `project:update` (project-scope) resuelto INLINE con
   * `PermissionService.can` (no es STRUCTURAL FGA, así que no usa `@RequirePermission`).
   */
  @Patch(':id')
  async updateGeneral(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const userId = this.requireUserId(authUser);
    const decision = await this.permissions.can(userId, 'project:update', { projectId: id });
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes el permiso "project:update".');
    }
    return this.projects.updateGeneral(id, dto);
  }

  /**
   * Elimina el proyecto (solo si está vacío).
   * Gate: permiso FUNCTIONAL `project:delete` (project-scope) resuelto INLINE con
   * `PermissionService.can`.
   */
  @Delete(':id')
  async remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    const decision = await this.permissions.can(userId, 'project:delete', { projectId: id });
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes el permiso "project:delete".');
    }
    return this.projects.remove(id);
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

  /**
   * Borra un servicio del proyecto (409 si tiene actividades o documentos).
   * Mismo gate de configuración del proyecto que crear/editar servicios.
   */
  @Delete(':id/services/:sid')
  @RequirePermission('can_define_kpi', { type: 'project', param: 'id' })
  deleteService(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('sid') sid: string,
  ) {
    this.requireUserId(authUser);
    return this.projects.deleteService(id, sid);
  }

  // ── Control de avance de obra (project:progress:manage → can_manage_progress) ──
  //
  // Se edita CELDA por celda y no la tabla entera: dos personas cargando
  // semanas distintas no se pisan, y un guardado parcial no reescribe valores
  // que el otro acaba de cambiar.

  @Patch(':id/avance/actividad')
  @RequirePermission('can_manage_progress', { type: 'project', param: 'id' })
  async editarAvanceActividad(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: EditarAvanceActividadDto,
  ): Promise<{ ok: true }> {
    this.requireUserId(authUser);
    await this.projects.editarAvanceActividad(id, dto);
    return { ok: true };
  }

  @Patch(':id/avance/semana')
  @RequirePermission('can_manage_progress', { type: 'project', param: 'id' })
  async editarSemana(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: EditarSemanaDto,
  ): Promise<{ ok: true }> {
    this.requireUserId(authUser);
    await this.projects.editarSemana(id, dto);
    return { ok: true };
  }

  /**
   * Foto de terreno de un cerco. Crea un `ProjectDocument` colgado de la tarea,
   * que es lo que el tablero ya lee para mostrarla en vez de la satelital.
   */
  @Post(':id/cercos/:taskId/foto')
  @RequirePermission('can_manage_progress', { type: 'project', param: 'id' })
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async subirFotoCerco(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @UploadedFile() foto: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
  ): Promise<{ url: string }> {
    const userId = this.requireUserId(authUser);
    if (!foto) {
      throw new BadRequestException('No llegó ninguna foto.');
    }
    return this.projects.subirFotoCerco(id, taskId, foto, userId);
  }

  @Delete(':id/cercos/:taskId/foto')
  @RequirePermission('can_manage_progress', { type: 'project', param: 'id' })
  async quitarFotoCerco(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ): Promise<{ quedan: number }> {
    this.requireUserId(authUser);
    return this.projects.quitarFotoCerco(id, taskId);
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

  /**
   * Gate de un permiso FUNCTIONAL org-scope vía la fachada `PermissionService`
   * (mismo patrón que `FaenasController`). `project:create` es FUNCTIONAL, así
   * que se decide con `can(...)` y no con `@RequirePermission` (que solo cubre
   * relaciones STRUCTURAL FGA).
   */
  private async requireFunctional(userId: string, permissionKey: string): Promise<void> {
    const decision = await this.permissions.can(userId, permissionKey);
    if (decision.effect !== 'allow') {
      throw new ForbiddenException(`No tienes el permiso "${permissionKey}".`);
    }
  }
}
