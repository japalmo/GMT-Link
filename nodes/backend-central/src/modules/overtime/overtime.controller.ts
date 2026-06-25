import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ORG_ID, ORG_OBJECT_TYPE } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CurrentUser } from '../../auth/current-user.decorator';
import { FgaService } from '../../fga/fga.service';
import { OvertimeService } from './overtime.service';
import {
  CreateOvertimeDto,
  ListOvertimeQueryDto,
  RejectOvertimeDto,
} from './dto/overtime.dto';
import type { OvertimeView } from './overtime.types';

/** Permiso FGA de gestión de finanzas (§6-3.3). */
const FINANCE_RELATION = 'can_manage_finance';

/**
 * Horas extra (§6-3.3 — mismo patrón que reembolsos, sin boleta).
 *
 * Rutas propias (`/me`, crear): AUTENTICADAS, "solo el dueño" como lógica de
 * service. Rutas de GESTIÓN (lista global, approve/reject/pay): protegidas por
 * `@RequirePermission('can_manage_finance', organization:gmt)`. `GET
 * /overtime/:id` es autenticada y admite dueño O gestor: el controller resuelve
 * `isManager` con un check FGA.
 *
 * `/me` se declara ANTES que `:id`.
 */
@Controller('overtime')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class OvertimeController {
  constructor(
    private readonly overtime: OvertimeService,
    private readonly fga: FgaService,
  ) {}

  /** Crea una solicitud de horas extra propia (PENDIENTE). */
  @Post()
  create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateOvertimeDto,
  ): Promise<OvertimeView> {
    return this.overtime.create(this.requireUserId(authUser), dto);
  }

  /** Lista las solicitudes propias. Filtro opcional `?status=`. */
  @Get('me')
  listMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query() query: ListOvertimeQueryDto,
  ): Promise<OvertimeView[]> {
    return this.overtime.listMine(this.requireUserId(authUser), query.status);
  }

  /**
   * Lista TODAS las solicitudes (gestor — RoleScopedList). Filtros opcionales
   * `?status=&userId=`. Requiere `can_manage_finance` sobre `organization:gmt`.
   */
  @Get()
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  listAll(@Query() query: ListOvertimeQueryDto): Promise<OvertimeView[]> {
    return this.overtime.listAll({ status: query.status, userId: query.userId });
  }

  /**
   * Detalle de una solicitud. Autenticada: la ve el DUEÑO o un GESTOR. El
   * controller resuelve `isManager` con un check FGA; el service decide el 404.
   */
  @Get(':id')
  async getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    const userId = this.requireUserId(authUser);
    const isManager = await this.isFinanceManager(userId);
    return this.overtime.getById(id, userId, isManager);
  }

  /** Aprueba (gestor). PENDIENTE→APROBADO. 409 si estado inválido. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  approve(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    return this.overtime.approve(this.requireUserId(authUser), id);
  }

  /** Rechaza (gestor). PENDIENTE→RECHAZADO. `reason` opcional (log). */
  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  reject(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: RejectOvertimeDto,
  ): Promise<OvertimeView> {
    return this.overtime.reject(this.requireUserId(authUser), id, dto.reason);
  }

  /** Marca pagada (gestor). Solo desde APROBADO→PAGADO. 409 si no. */
  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission(FINANCE_RELATION, { type: ORG_OBJECT_TYPE, id: ORG_ID })
  pay(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ): Promise<OvertimeView> {
    return this.overtime.pay(this.requireUserId(authUser), id);
  }

  /** ¿El usuario es gestor de finanzas (FGA `can_manage_finance` sobre la org)? */
  private isFinanceManager(userId: string): Promise<boolean> {
    return this.fga.check({
      user: `user:${userId}`,
      relation: FINANCE_RELATION,
      object: `${ORG_OBJECT_TYPE}:${ORG_ID}`,
    });
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
