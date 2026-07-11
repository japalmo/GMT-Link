import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FinanceStatus } from '@prisma/client';
import type { OvertimeRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextFinanceStatus } from '../finance/finance-status.util';
import type { FinanceTransition } from '../finance/finance-status.util';
import { computeHours } from './overtime-hours.util';
import { monthRange } from '../finance/finance-month.util';
import { summarizeOvertime } from './overtime-summary.util';
import type { OvertimeSummary } from './overtime-summary.util';
import type { CreateOvertimeDto } from './dto/overtime.dto';
import type { OvertimeView } from './overtime.types';

/** Tipo de notificación que recibe el solicitante en cada transición (§6-2.2). */
const NOTIFICATION_TYPE = 'overtime.decided';

/** Enlace destino de la notificación (ruta del front). */
const OVERTIME_LINK = '/finanzas/horas';

/** Selección de datos del solicitante para la vista del gestor. */
const REQUESTER_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

/** Fila con el solicitante (y proyecto) incluidos (vistas de gestión). */
type OvertimeWithRequester = Prisma.OvertimeRequestGetPayload<{
  include: { user: typeof REQUESTER_SELECT; project: { select: { name: true } } };
}>;

/** Filtros de listado (ya parseados desde el query). */
export interface ListOvertimeFilters {
  status?: FinanceStatus;
  userId?: string;
  projectId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  month?: string;
  order?: 'asc' | 'desc';
}

/**
 * Horas extra (§6-3.3, mismo patrón que reembolsos — sin boleta).
 *
 * Seguridad: el `userId` SIEMPRE llega del controller (sesión), nunca del body.
 * "Solo el dueño" (crear/listar propios) es lógica de este service. La GESTIÓN
 * (lista global, aprobar/rechazar/pagar) la autoriza OpenFGA en el controller vía
 * `@RequirePermission('can_manage_finance', organization:gmt)`. `getById` admite
 * al dueño O a un gestor (la decisión es lógica de service, sin guard).
 */
@Injectable()
export class OvertimeService {
  private readonly logger = new Logger(OvertimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Crea una HE. `canOnBehalf` lo resuelve el controller (permiso
   * `finance:overtime:create:onbehalf`):
   *  - sin permiso: la fecha se FUERZA al día en curso y no puede crear a nombre de otro.
   *  - con permiso: puede fijar cualquier fecha y `onBehalfOfUserId` (trabajador objetivo).
   * `endTime` ausente => borrador (isDraft=true, hours=null).
   */
  async create(
    creatorId: string,
    dto: CreateOvertimeDto,
    canOnBehalf: boolean,
  ): Promise<OvertimeView> {
    const targetWorkerId = canOnBehalf && dto.onBehalfOfUserId ? dto.onBehalfOfUserId : creatorId;
    const filedBy = targetWorkerId !== creatorId ? creatorId : null;
    const date = canOnBehalf ? parseDate(dto.date) : startOfTodayUtc();
    const isDraft = dto.endTime === undefined;
    const hours = isDraft ? null : computeHours(dto.startTime, dto.endTime as string);

    const row = await this.prisma.overtimeRequest.create({
      data: {
        userId: targetWorkerId,
        date,
        startTime: dto.startTime,
        endTime: dto.endTime ?? null,
        hours,
        isDraft,
        reason: dto.reason ?? null,
        projectId: dto.projectId ?? null,
        projectOther: dto.projectOther ?? null,
        authorizedById: dto.authorizedById ?? null,
        onBehalfOfUserId: filedBy,
        status: FinanceStatus.PENDIENTE,
      },
    });
    return toView(row);
  }

  /** Cierra un borrador propio con la hora de término (calcula horas, isDraft=false). */
  async close(userId: string, id: string, endTime: string): Promise<OvertimeView> {
    const current = await this.prisma.overtimeRequest.findFirst({ where: { id, userId } });
    if (!current) {
      throw new NotFoundException('La solicitud de horas extra no existe o no te pertenece.');
    }
    if (!current.isDraft) {
      throw new ConflictException('La solicitud ya fue cerrada.');
    }
    if (!current.startTime) {
      throw new BadRequestException('La solicitud no tiene hora de inicio.');
    }
    const row = await this.prisma.overtimeRequest.update({
      where: { id },
      data: { endTime, hours: computeHours(current.startTime, endTime), isDraft: false },
    });
    return toView(row);
  }

  /** Lista las solicitudes propias (orden createdAt desc). Filtro opcional `status`. */
  async listMine(userId: string, status?: FinanceStatus): Promise<OvertimeView[]> {
    const where: Prisma.OvertimeRequestWhereInput = { userId };
    if (status !== undefined) {
      where.status = status;
    }
    const rows = await this.prisma.overtimeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  /**
   * Lista TODAS las solicitudes (vista del gestor — RoleScopedList). El permiso
   * lo verifica el guard. Filtros opcionales `status` y `userId`. Incluye datos
   * del solicitante.
   */
  async listAll(filters: ListOvertimeFilters): Promise<OvertimeView[]> {
    const rows = await this.prisma.overtimeRequest.findMany({
      where: buildOvertimeWhere(filters),
      include: { user: REQUESTER_SELECT, project: { select: { name: true } } },
      orderBy: { date: filters.order ?? 'desc' },
    });
    return rows.map(toViewWithRequester);
  }

  /** Agregaciones para las cards (spec §5.2), sobre el MISMO filtro que la tabla. */
  async summary(filters: ListOvertimeFilters): Promise<OvertimeSummary> {
    const rows = await this.prisma.overtimeRequest.findMany({
      where: buildOvertimeWhere(filters),
      include: { user: REQUESTER_SELECT, project: { select: { name: true } } },
    });
    return summarizeOvertime(
      rows.map((r) => ({
        userId: r.userId,
        requesterName: `${r.user.firstName} ${r.user.lastName}`,
        hours: r.hours,
        status: r.status,
        isDraft: r.isDraft,
        projectId: r.projectId,
        projectName: r.project?.name ?? null,
      })),
    );
  }

  /**
   * Detalle visible para el DUEÑO o un GESTOR. `isManager` lo resuelve el
   * controller (check FGA); si no es ninguno, 404. El gestor recibe los datos del
   * solicitante.
   */
  async getById(
    id: string,
    requesterId: string,
    isManager: boolean,
  ): Promise<OvertimeView> {
    const row = await this.prisma.overtimeRequest.findUnique({
      where: { id },
      include: { user: REQUESTER_SELECT, project: { select: { name: true } } },
    });
    if (!row || (!isManager && row.userId !== requesterId)) {
      throw new NotFoundException('La solicitud de horas extra no existe.');
    }
    return isManager ? toViewWithRequester(row) : toView(row);
  }

  /** Aprueba (gestor; gating FGA en el controller). PENDIENTE→APROBADO. */
  async approve(managerId: string, id: string): Promise<OvertimeView> {
    return this.transition(id, 'approve', managerId);
  }

  /**
   * Rechaza (gestor). PENDIENTE→RECHAZADO. El `reason` de la decisión no se
   * persiste en la fila (el schema no tiene campo, MVP): viaja al solicitante en
   * el BODY de la notificación y se registra en log.
   */
  async reject(managerId: string, id: string, reason?: string): Promise<OvertimeView> {
    if (reason) {
      this.logger.log(`Horas extra ${id} rechazadas por ${managerId}. Motivo: ${reason}`);
    }
    return this.transition(id, 'reject', managerId, reason);
  }

  /** Marca pagada (gestor). Solo desde APROBADO→PAGADO. */
  async pay(managerId: string, id: string): Promise<OvertimeView> {
    return this.transition(id, 'pay', managerId);
  }

  // ============ Helpers ============

  /**
   * Aplica una transición validada (máquina común de finanzas): lee el actual
   * (404), valida (409 si inválida), persiste estado + decisor y notifica al
   * SOLICITANTE.
   */
  private async transition(
    id: string,
    transition: FinanceTransition,
    managerId: string,
    reason?: string,
  ): Promise<OvertimeView> {
    const current = await this.prisma.overtimeRequest.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('La solicitud de horas extra no existe.');
    }
    if (current.isDraft && transition !== 'reject') {
      throw new ConflictException('No se puede aprobar/pagar una solicitud en borrador.');
    }
    const status = nextFinanceStatus(current.status, transition);

    const row = await this.prisma.overtimeRequest.update({
      where: { id },
      data: {
        status,
        decidedById: managerId,
        decidedAt: new Date(),
        ...(transition === 'reject' && reason ? { rejectionReason: reason } : {}),
      },
    });

    await this.notifyRequester(row, status, reason);
    return toView(row);
  }

  /** Notifica al solicitante el resultado de la transición. */
  private async notifyRequester(
    row: OvertimeRequest,
    status: FinanceStatus,
    reason?: string,
  ): Promise<void> {
    await this.notifications.create(row.userId, {
      type: NOTIFICATION_TYPE,
      title: `Tu solicitud de horas extra cambió a ${statusLabel(status)}`,
      body: reason ? `Motivo: ${reason}` : undefined,
      link: OVERTIME_LINK,
    });
  }
}

/** Etiqueta legible del estado para el texto de la notificación. */
function statusLabel(status: FinanceStatus): string {
  switch (status) {
    case FinanceStatus.APROBADO:
      return 'aprobado';
    case FinanceStatus.RECHAZADO:
      return 'rechazado';
    case FinanceStatus.PAGADO:
      return 'pagado';
    case FinanceStatus.PENDIENTE:
      return 'pendiente';
  }
}

/** Mapea la fila Prisma a la vista pública (fechas a ISO-8601), sin solicitante. */
function toView(row: OvertimeRequest): OvertimeView {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date.toISOString(),
    hours: row.hours,
    reason: row.reason,
    startTime: row.startTime,
    endTime: row.endTime,
    isDraft: row.isDraft,
    projectId: row.projectId,
    projectOther: row.projectOther,
    authorizedById: row.authorizedById,
    onBehalfOfUserId: row.onBehalfOfUserId,
    rejectionReason: row.rejectionReason,
    status: row.status,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Vista de gestión: incluye los datos del solicitante. */
function toViewWithRequester(row: OvertimeWithRequester): OvertimeView {
  return {
    ...toView(row),
    requester: {
      id: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      email: row.user.email,
    },
  };
}

/** Convierte un string ISO a Date; inválido → 400. */
function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Fecha inválida.');
  }
  return date;
}

/** Medianoche UTC del día en curso (para forzar la fecha de HE sin permiso onBehalf). */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

/** Construye el `where` de HE desde los filtros (fecha/mes/proyecto/cliente/trabajador). */
function buildOvertimeWhere(f: ListOvertimeFilters): Prisma.OvertimeRequestWhereInput {
  const where: Prisma.OvertimeRequestWhereInput = {};
  if (f.status !== undefined) where.status = f.status;
  if (f.userId !== undefined) where.userId = f.userId;
  if (f.projectId !== undefined) where.projectId = f.projectId;
  if (f.clientId !== undefined) where.project = { clientId: f.clientId };

  const dateWhere: Prisma.DateTimeFilter = {};
  if (f.month) {
    const { gte, lt } = monthRange(f.month);
    dateWhere.gte = gte;
    dateWhere.lt = lt;
  }
  if (f.date) {
    const day = new Date(f.date);
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    dateWhere.gte = start;
    dateWhere.lt = end;
  }
  if (f.dateFrom) dateWhere.gte = new Date(f.dateFrom);
  if (f.dateTo) dateWhere.lte = new Date(f.dateTo);
  if (Object.keys(dateWhere).length > 0) where.date = dateWhere;

  return where;
}
