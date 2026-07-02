import {
  BadRequestException,
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

/** Fila con el solicitante incluido (vistas de gestión). */
type OvertimeWithRequester = Prisma.OvertimeRequestGetPayload<{
  include: { user: typeof REQUESTER_SELECT };
}>;

/** Filtros de listado (ya parseados desde el query). */
export interface ListOvertimeFilters {
  status?: FinanceStatus;
  /** Solo aplica a la vista del gestor (lista global). */
  userId?: string;
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

  /** Crea una solicitud de horas extra del propio usuario en estado PENDIENTE. */
  async create(userId: string, dto: CreateOvertimeDto): Promise<OvertimeView> {
    const row = await this.prisma.overtimeRequest.create({
      data: {
        userId,
        date: parseDate(dto.date),
        hours: dto.hours,
        reason: dto.reason,
        status: FinanceStatus.PENDIENTE,
      },
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
    const where: Prisma.OvertimeRequestWhereInput = {};
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.userId !== undefined) {
      where.userId = filters.userId;
    }
    const rows = await this.prisma.overtimeRequest.findMany({
      where,
      include: { user: REQUESTER_SELECT },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toViewWithRequester);
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
      include: { user: REQUESTER_SELECT },
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
    const status = nextFinanceStatus(current.status, transition);

    const row = await this.prisma.overtimeRequest.update({
      where: { id },
      data: { status, decidedById: managerId, decidedAt: new Date() },
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
