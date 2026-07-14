import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { startOfTodaySantiago } from '../finance/finance-time.util';
import { buildOvertimeSummary } from './overtime-summary.util';
import type { OvertimeSummary } from './overtime-summary.util';
import type { CreateOvertimeDto, UpdateOvertimeDto } from './dto/overtime.dto';
import type { OvertimeView, Paginated } from './overtime.types';

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
  /** Tope de filas de la página (default 30, máx. 100). */
  limit?: number;
  /** Cursor keyset opaco (página siguiente); ver doc de `listAll`. */
  cursor?: string;
}

/**
 * Horas extra (§6-3.3, mismo patrón que reembolsos — sin boleta).
 *
 * Seguridad: el `userId` SIEMPRE llega del controller (sesión), nunca del body.
 * "Solo el dueño" (crear/listar propios) es lógica de este service. La GESTIÓN
 * (lista global, aprobar/rechazar/pagar) la autoriza el controller con un check de
 * permiso funcional inline (`PermissionService.can`, respaldado por Postgres).
 * `getById` admite al dueño O a un gestor (la decisión es lógica de service).
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
    const date = canOnBehalf ? parseDate(dto.date) : startOfTodaySantiago();
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

  /**
   * Edita una solicitud PROPIA aún PENDIENTE (spec §5.6). Solo el dueño
   * (`findFirst` acota por `userId`) y solo mientras no esté resuelta. Recomputa
   * `hours`/`isDraft` desde `startTime`/`endTime` (endTime ausente => vuelve a
   * borrador con `hours=null`), igual que `create`/`close`.
   */
  async update(userId: string, id: string, dto: UpdateOvertimeDto): Promise<OvertimeView> {
    const current = await this.prisma.overtimeRequest.findFirst({ where: { id, userId } });
    if (!current) {
      throw new NotFoundException('La solicitud de horas extra no existe o no te pertenece.');
    }
    if (current.status !== FinanceStatus.PENDIENTE) {
      throw new ConflictException('No se puede editar una solicitud ya resuelta.');
    }
    const isDraft = dto.endTime === undefined;
    const hours = isDraft ? null : computeHours(dto.startTime, dto.endTime as string);

    const row = await this.prisma.overtimeRequest.update({
      where: { id },
      data: {
        startTime: dto.startTime,
        endTime: dto.endTime ?? null,
        hours,
        isDraft,
        reason: dto.reason ?? null,
        projectId: dto.projectId ?? null,
        projectOther: dto.projectOther ?? null,
        authorizedById: dto.authorizedById ?? null,
      },
    });
    return toView(row);
  }

  /**
   * Elimina una solicitud PROPIA aún PENDIENTE (spec §5.6). Mismo guard que
   * `update` (solo dueño, solo pendiente). `OvertimeRequest` no tiene hijos, así
   * que el hard delete es seguro.
   */
  async remove(userId: string, id: string): Promise<void> {
    const current = await this.prisma.overtimeRequest.findFirst({ where: { id, userId } });
    if (!current) {
      throw new NotFoundException('La solicitud de horas extra no existe o no te pertenece.');
    }
    if (current.status !== FinanceStatus.PENDIENTE) {
      throw new ConflictException('No se puede eliminar una solicitud ya resuelta.');
    }
    await this.prisma.overtimeRequest.delete({ where: { id } });
  }

  /**
   * Lista las solicitudes propias con paginación KEYSET estable. El orden es
   * `createdAt desc` — NO único — así que se desempata por `id desc`: el cursor
   * de la página siguiente es `${createdAt.toISOString()}_${id}` del último item
   * de la página previa, y la siguiente pide `createdAt < cursor.createdAt` OR
   * (`createdAt = cursor.createdAt` AND `id < cursor.id`). Se trae `limit + 1`
   * filas para saber si hay más páginas sin un `count` adicional. `limit`
   * default 30, máximo 100. Filtro opcional `status`.
   */
  async listMine(
    userId: string,
    opts: { status?: FinanceStatus; limit?: number; cursor?: string } = {},
  ): Promise<Paginated<OvertimeView>> {
    const { status, cursor } = opts;
    const limit = normalizeLimit(opts.limit);

    const where: Prisma.OvertimeRequestWhereInput = { userId };
    if (status !== undefined) {
      where.status = status;
    }
    if (cursor) {
      const decoded = decodeKeysetCursor(cursor);
      if (decoded) {
        where.AND = createdAtKeysetWhere(decoded);
      }
    }

    const rows = await this.prisma.overtimeRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeKeysetCursor(lastRow.createdAt, lastRow.id) : null;

    return { items: pageRows.map(toView), nextCursor };
  }

  /**
   * Lista TODAS las solicitudes (vista del gestor — RoleScopedList) con
   * paginación KEYSET estable. El orden es `date` (fecha de las horas
   * trabajadas), configurable asc/desc vía `filters.order` (default desc) — NO
   * único — así que se desempata por `id` en la MISMA dirección: el cursor de la
   * página siguiente es `${date.toISOString()}_${id}` del último item de la
   * página previa. El permiso lo verifica el guard. Filtros opcionales `status` /
   * `userId` / proyecto / cliente / rango de fecha / mes. Incluye datos del
   * solicitante.
   */
  async listAll(filters: ListOvertimeFilters): Promise<Paginated<OvertimeView>> {
    const limit = normalizeLimit(filters.limit);
    const order = filters.order ?? 'desc';
    const where = buildOvertimeWhere(filters);

    if (filters.cursor) {
      const decoded = decodeKeysetCursor(filters.cursor);
      if (decoded) {
        where.AND = dateKeysetWhere(decoded, order);
      }
    }

    const rows = await this.prisma.overtimeRequest.findMany({
      where,
      include: { user: REQUESTER_SELECT, project: { select: { name: true } } },
      orderBy: [{ date: order }, { id: order }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeKeysetCursor(lastRow.date, lastRow.id) : null;

    return { items: pageRows.map(toViewWithRequester), nextCursor };
  }

  /**
   * Agregaciones para las cards (spec §5.2), sobre el MISMO filtro que la tabla.
   * Se calcula todo en BD (conteos por estado/borrador y sumas de horas por
   * trabajador y por proyecto) en vez de traer TODAS las filas y sumar en JS. Los
   * nombres se resuelven con `findMany` acotados a los ids que aparecen en el top.
   */
  async summary(filters: ListOvertimeFilters): Promise<OvertimeSummary> {
    const where = buildOvertimeWhere(filters);

    const [statusGroups, workerGroups, projectGroups] = await Promise.all([
      this.prisma.overtimeRequest.groupBy({ by: ['status', 'isDraft'], where, _count: true }),
      this.prisma.overtimeRequest.groupBy({
        by: ['userId'],
        // `hours: { not: null }` excluye los borradores del ranking: con `hours`
        // nullable, Postgres ordena NULLS FIRST y un trabajador con solo
        // borradores (SUM=NULL) treparía a la cima. Filtrando el NULL, quien no
        // tiene horas reales simplemente no aparece.
        where: { ...where, hours: { not: null } },
        _sum: { hours: true },
        orderBy: { _sum: { hours: 'desc' } },
      }),
      this.prisma.overtimeRequest.groupBy({
        by: ['projectId'],
        // Mismo motivo que el ranking por trabajador: excluir borradores (hours
        // NULL) para que no encabecen el desglose por proyecto.
        where: { ...where, projectId: { not: null }, hours: { not: null } },
        _sum: { hours: true },
        orderBy: { _sum: { hours: 'desc' } },
      }),
    ]);

    const userIds = workerGroups.map((g) => g.userId);
    const projectIds = projectGroups.flatMap((g) => (g.projectId === null ? [] : [g.projectId]));

    const [users, projects] = await Promise.all([
      userIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
      projectIds.length > 0
        ? this.prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const workerNames = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));

    return buildOvertimeSummary({
      statusCounts: statusGroups.map((g) => ({
        status: g.status,
        isDraft: g.isDraft,
        count: g._count,
      })),
      ranking: workerGroups.map((g) => ({ userId: g.userId, hours: g._sum.hours ?? 0 })),
      byProject: projectGroups.flatMap((g) =>
        g.projectId === null ? [] : [{ projectId: g.projectId, hours: g._sum.hours ?? 0 }],
      ),
      workerNames,
      projectNames,
    });
  }

  /**
   * Detalle visible para el DUEÑO o un GESTOR. `isManager` lo resuelve el
   * controller (check de permiso inline); si no es ninguno, 404. El gestor recibe los datos del
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

  /** Aprueba (gestor; gating por permiso inline en el controller). PENDIENTE→APROBADO. */
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
    // Maker-checker (control interno): nadie aprueba ni paga sus propias horas extra.
    if (transition === 'approve' && current.userId === managerId) {
      throw new ForbiddenException('No puedes aprobar tus propias horas extra.');
    }
    if (transition === 'pay' && current.userId === managerId) {
      throw new ForbiddenException('No puedes registrar el pago de tus propias horas extra.');
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

/**
 * Normaliza el `limit` de paginación: default 30, tope 100, mínimo 1. Ignora
 * valores no numéricos (p. ej. un `?limit=` mal formado que llega como NaN).
 */
function normalizeLimit(requested: number | undefined): number {
  return requested !== undefined && Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), 100)
    : 30;
}

/** Codifica el cursor keyset compuesto (fecha, `id`) de `listMine`/`listAll`. */
function encodeKeysetCursor(date: Date, id: string): string {
  return `${date.toISOString()}_${id}`;
}

/**
 * Decodifica un cursor de `listMine`/`listAll`. `null` si el formato es
 * inválido (cursor corrupto o mal formado): en ese caso se ignora en vez de
 * romper la página, igual que un `limit` no numérico.
 */
function decodeKeysetCursor(raw: string): { date: Date; id: string } | null {
  const separatorIndex = raw.indexOf('_');
  if (separatorIndex === -1) return null;
  const isoPart = raw.slice(0, separatorIndex);
  const idPart = raw.slice(separatorIndex + 1);
  const date = new Date(isoPart);
  if (Number.isNaN(date.getTime()) || idPart.length === 0) return null;
  return { date, id: idPart };
}

/** OR de keyset para `listMine` (orden fijo `createdAt desc`). */
function createdAtKeysetWhere(cursor: { date: Date; id: string }): Prisma.OvertimeRequestWhereInput {
  return {
    OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }],
  };
}

/** OR de keyset para `listAll` (orden `date`, configurable asc/desc vía `order`). */
function dateKeysetWhere(
  cursor: { date: Date; id: string },
  order: 'asc' | 'desc',
): Prisma.OvertimeRequestWhereInput {
  return order === 'desc'
    ? { OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }] }
    : { OR: [{ date: { gt: cursor.date } }, { date: cursor.date, id: { gt: cursor.id } }] };
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
  if (f.dateTo) {
    // Half-open: `lt` del día siguiente (mismo criterio que el filtro `date`
    // exacto) para no excluir un `dateTo` con hora ≠ 0. Se mantiene UTC.
    const end = new Date(f.dateTo);
    end.setUTCDate(end.getUTCDate() + 1);
    dateWhere.lt = end;
  }
  if (Object.keys(dateWhere).length > 0) where.date = dateWhere;

  return where;
}
