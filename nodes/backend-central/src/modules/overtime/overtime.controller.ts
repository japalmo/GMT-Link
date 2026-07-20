import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { FinanceStatus } from '@prisma/client';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { PermissionService } from '../../authz/permission.service';
import { OvertimeService } from './overtime.service';
import {
  CloseOvertimeDto,
  CreateOvertimeDto,
  ListOvertimeQueryDto,
  RejectOvertimeDto,
  UpdateOvertimeDto,
} from './dto/overtime.dto';
import type { OvertimeView, Paginated } from './overtime.types';
import type { OvertimeSummary } from './overtime-summary.util';

/** Permisos funcionales de finanzas (spec §2.2). */
const P_CREATE = 'finance:request:create';
const P_ONBEHALF = 'finance:overtime:create:onbehalf';
const P_VIEW_ALL = 'finance:request:view:all';
const P_VIEW_OT = 'finance:overtime:view:all';
const P_APPROVE = 'finance:request:approve';
const P_PAY = 'finance:payment:register';

/**
 * Horas extra (spec §5.6). Gating por PERMISO FUNCIONAL vía `PermissionService.can`
 * inline (patrón ClientsController), no por FGA. Crear requiere
 * `finance:request:create`; crear a nombre de otro / con fecha libre requiere
 * además `finance:overtime:create:onbehalf`. Ver todo requiere
 * `finance:request:view:all` O `finance:overtime:view:all` (subconjunto RH).
 * `/me`, `/summary` se declaran ANTES de `:id`.
 */
@Controller('overtime')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class OvertimeController {
  constructor(
    private readonly overtime: OvertimeService,
    private readonly permissions: PermissionService,
  ) {}

  @Post()
  async create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateOvertimeDto,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_CREATE);
    const canOnBehalf = (await this.permissions.can(userId, P_ONBEHALF)).effect === 'allow';
    return this.overtime.create(userId, dto, canOnBehalf);
  }

  @Get('me')
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListOvertimeQueryDto,
  ): Promise<Paginated<OvertimeView>> {
    return this.overtime.listMine(this.requireUserId(authUser), {
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('summary')
  async summary(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListOvertimeQueryDto,
  ): Promise<OvertimeSummary> {
    await this.requireViewAll(this.requireUserId(authUser));
    return this.overtime.summary(this.toFilters(query));
  }

  @Get()
  async listAll(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListOvertimeQueryDto,
  ): Promise<Paginated<OvertimeView>> {
    await this.requireViewAll(this.requireUserId(authUser));
    return this.overtime.listAll(this.toFilters(query));
  }

  /**
   * Lista con el MOTOR de tablas server-side (offset): filtro por estado y orden
   * (fecha/horas/estado/solicitante) sobre TODAS las horas extra, con página + total.
   * Lo consume la tabla de Gestión. Mismo gate "ver todo" que `listAll`. DEBE
   * declararse antes de `@Get(':id')`.
   */
  @Get('table')
  async listTable(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filters') filters?: Record<string, string>,
  ): Promise<TablePage<OvertimeView>> {
    await this.requireViewAll(this.requireUserId(authUser));
    const req: TableRequest = {
      page: page !== undefined ? Number(page) : 1,
      pageSize: pageSize !== undefined ? Number(pageSize) : 10,
      sortBy,
      sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
      filters: filters && typeof filters === 'object' ? filters : undefined,
    };
    const rawStatus = typeof filters?.status === 'string' ? filters.status : '';
    const status = (Object.values(FinanceStatus) as string[]).includes(rawStatus)
      ? (rawStatus as FinanceStatus)
      : undefined;
    return this.overtime.listAllTable({ status }, req);
  }

  /**
   * Reporte mensual (Excel) de las HE APROBADAS del mes contable (cierre día 20). Lo
   * genera quien puede APROBAR (admin de contrato / gerencia): `finance:request:approve`.
   * `month` = "YYYY-MM" obligatorio. DEBE declararse antes de `@Get(':id')` para que
   * "report" no lo capture la ruta con parámetro. Sin extensión en la ruta (el nombre
   * del archivo va en Content-Disposition) para no depender del match de "." en la ruta.
   */
  @Get('report/monthly')
  async monthlyReport(
    @CurrentUser() authUser: AuthUser | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('month') month?: string,
  ): Promise<StreamableFile> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('Debes indicar el mes en formato "YYYY-MM" (mes 01-12).');
    }
    const { buffer, filename } = await this.overtime.monthlyApprovedReport(month);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }

  @Get(':id')
  async getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    const isManager = await this.hasViewAll(userId);
    return this.overtime.getById(id, userId, isManager);
  }

  /** Cierra un borrador propio con la hora de término. */
  @Post(':id/close')
  @HttpCode(200)
  close(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: CloseOvertimeDto,
  ): Promise<OvertimeView> {
    return this.overtime.close(this.requireUserId(authUser), id, dto.endTime);
  }

  /** Edita una solicitud propia aún PENDIENTE (solo dueño; el service valida). */
  @Put(':id')
  update(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateOvertimeDto,
  ): Promise<OvertimeView> {
    return this.overtime.update(this.requireUserId(authUser), id, dto);
  }

  /**
   * Elimina una solicitud de horas extra: el DUEÑO borra la suya, o quien GESTIONA
   * finanzas (`finance:request:approve`) borra cualquiera. En cualquier estado salvo
   * PAGADO. La autorización la decide EL SERVICE (ADR-0001): 404 para quien no es
   * dueño ni gestor, 409 si está pagada.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    const userId = this.requireUserId(authUser);
    // El SERVICE es el único gate (ADR-0001): borra el dueño (aunque no tenga
    // finance:request:create, p.ej. una HE cargada a su nombre) o quien gestiona
    // finanzas; 404 para el resto, 409 si está pagada.
    const canManage = (await this.permissions.can(userId, P_APPROVE)).effect === 'allow';
    await this.overtime.remove(userId, id, canManage);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.overtime.approve(userId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectOvertimeDto,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_APPROVE);
    return this.overtime.reject(userId, id, dto.reason);
  }

  @Post(':id/pay')
  @HttpCode(200)
  async pay(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    await this.require(userId, P_PAY);
    return this.overtime.pay(userId, id);
  }

  private toFilters(q: ListOvertimeQueryDto): {
    status?: (typeof q)['status'];
    userId?: string;
    projectId?: string;
    clientId?: string;
    dateFrom?: string;
    dateTo?: string;
    date?: string;
    month?: string;
    order?: 'asc' | 'desc';
    limit?: number;
    cursor?: string;
  } {
    return {
      status: q.status,
      userId: q.userId,
      projectId: q.projectId,
      clientId: q.clientId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      date: q.date,
      month: q.month,
      order: q.order,
      limit: q.limit,
      cursor: q.cursor,
    };
  }

  /** "Ver todo" = tiene view:all O el subconjunto overtime:view:all (RH). */
  private async hasViewAll(userId: string): Promise<boolean> {
    if ((await this.permissions.can(userId, P_VIEW_ALL)).effect === 'allow') return true;
    return (await this.permissions.can(userId, P_VIEW_OT)).effect === 'allow';
  }

  private async requireViewAll(userId: string): Promise<void> {
    if (!(await this.hasViewAll(userId))) {
      throw new ForbiddenException('No tienes permiso para ver todas las horas extra.');
    }
  }

  private async require(userId: string, permissionKey: string): Promise<void> {
    if ((await this.permissions.can(userId, permissionKey)).effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para esta acción de finanzas.');
    }
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
