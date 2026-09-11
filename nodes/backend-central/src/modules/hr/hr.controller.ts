import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { PermissionService } from '../../authz/permission.service';
import { HrService } from './hr.service';
import {
  UpsertAccreditationDto,
  UpsertExamDto,
  UpsertInductionDto,
} from './dto/hr.dto';
import type {
  HrAccreditation,
  HrExam,
  HrHours,
  HrInduction,
  HrWorkerRow,
  HrWorkerSummary,
} from '@gmt-platform/contracts';

/**
 * RRHH — antecedentes laborales y habilitación del trabajador.
 *
 * Dos permisos, consultados por clave y nunca comparando roles (ADR-0001):
 * `hr:read` para consultar y `hr:manage` para crear, editar y borrar. Ninguno
 * reparte acceso a la plataforma: los roles siguen administrándose en Usuarios.
 *
 * Son FUNCTIONAL y sin recurso, así que `can` resuelve con los grants de
 * Postgres y no consulta OpenFGA: RRHH es de toda la empresa, no de un proyecto.
 */
@Controller('hr')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class HrController {
  constructor(
    private readonly hr: HrService,
    private readonly permissions: PermissionService,
  ) {}

  // ── Directorio y ficha ────────────────────────────────────────────────────

  @Get('workers')
  async listWorkers(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('search') search?: string,
  ): Promise<HrWorkerRow[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listWorkers(search);
  }

  @Get('workers/:userId/summary')
  async summary(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrWorkerSummary> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.summary(userId);
  }

  @Get('workers/:userId/hours')
  async hours(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<HrHours> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.hours(userId, from, to);
  }

  // ── Exámenes ──────────────────────────────────────────────────────────────

  @Get('workers/:userId/exams')
  async listExams(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrExam[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listExams(userId);
  }

  @Post('exams')
  async createExam(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpsertExamDto,
  ): Promise<HrExam> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertExam(dto);
  }

  @Put('exams/:id')
  async updateExam(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertExamDto,
  ): Promise<HrExam> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertExam(dto, id);
  }

  @Delete('exams/:id')
  async removeExam(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.removeExam(id);
  }

  // ── Inducciones ───────────────────────────────────────────────────────────

  @Get('workers/:userId/inductions')
  async listInductions(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrInduction[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listInductions(userId);
  }

  @Post('inductions')
  async createInduction(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpsertInductionDto,
  ): Promise<HrInduction> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertInduction(dto);
  }

  @Put('inductions/:id')
  async updateInduction(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertInductionDto,
  ): Promise<HrInduction> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertInduction(dto, id);
  }

  @Delete('inductions/:id')
  async removeInduction(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.removeInduction(id);
  }

  // ── Acreditaciones ────────────────────────────────────────────────────────

  @Get('workers/:userId/accreditations')
  async listAccreditations(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('userId') userId: string,
  ): Promise<HrAccreditation[]> {
    await this.assertPuede(authUser, 'hr:read');
    return this.hr.listAccreditations(userId);
  }

  @Post('accreditations')
  async createAccreditation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpsertAccreditationDto,
  ): Promise<HrAccreditation> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertAccreditation(dto);
  }

  @Put('accreditations/:id')
  async updateAccreditation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertAccreditationDto,
  ): Promise<HrAccreditation> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.upsertAccreditation(dto, id);
  }

  @Delete('accreditations/:id')
  async removeAccreditation(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<{ removed: true }> {
    await this.assertPuede(authUser, 'hr:manage');
    return this.hr.removeAccreditation(id);
  }

  /**
   * Gate de la sección. `directory:view:extended` se acepta para LEER porque es
   * el permiso que encendía la sección cuando se llamaba Directorio: quien ya
   * la tenía no debe perderla por el cambio de nombre.
   */
  private async assertPuede(
    authUser: AuthUser | undefined,
    clave: 'hr:read' | 'hr:manage',
  ): Promise<void> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    const claves: string[] =
      clave === 'hr:read' ? ['hr:read', 'hr:manage', 'directory:view:extended'] : ['hr:manage'];
    const decisiones = await Promise.all(
      claves.map((k) => this.permissions.can(authUser.id, k)),
    );
    if (!decisiones.some((d) => d.effect === 'allow')) {
      throw new ForbiddenException(
        clave === 'hr:manage'
          ? 'No tienes permisos para modificar antecedentes en RRHH.'
          : 'No tienes permisos para ver RRHH.',
      );
    }
  }
}
