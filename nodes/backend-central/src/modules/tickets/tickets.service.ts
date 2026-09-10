import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../../authz/permission.service';
import {
  tableAndWhere,
  tableOrderBy,
  tablePage,
  tableSearchWhere,
  tableSkipTake,
} from '../../common/table-pagination.util';
import { santiagoDateParts } from '../finance/finance-time.util';
import {
  findTransition,
  slaTriageDueAt,
  transitionsFrom,
} from './ticket-state-machine';
import type {
  CommentTicketDto,
  CreateTicketDto,
  TransitionTicketDto,
  TriageTicketDto,
} from './dto/tickets.dto';

const P_CREATE = 'ticket:create';
const P_READ_ALL = 'ticket:read:all';
const P_TRIAGE = 'ticket:triage';

/** Estados que cuentan como "en curso" en el panel (ni cerrados ni rechazados). */
const EN_CURSO: TicketStatus[] = [
  TicketStatus.EN_TRIAGE,
  TicketStatus.REQUIERE_INFO,
  TicketStatus.EN_BACKLOG,
  TicketStatus.EN_LEVANTAMIENTO,
  TicketStatus.EN_DISENO,
  TicketStatus.EN_DESARROLLO,
  TicketStatus.EN_QA,
  TicketStatus.EN_UAT,
  TicketStatus.ENTREGADO,
];

/** `include` común: todo lo que la vista necesita sin pedir joins de más. */
const TICKET_INCLUDE = {
  department: { select: { id: true, name: true } },
  faena: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.TicketInclude;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  // ── Lecturas ───────────────────────────────────────────────────────────────

  /** Bandeja del solicitante: solo los tickets que levantó este usuario. */
  async listMine(userId: string): Promise<ReturnType<TicketsService['toView']>[]> {
    const rows = await this.prisma.ticket.findMany({
      where: { requesterId: userId },
      include: TICKET_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Panel de Informática con el motor de tablas. Orden por defecto: el SLA más
   * próximo a vencer primero, que es la pregunta que el área se hace al abrir.
   * Los tickets sin SLA (borradores) quedan al final con `nulls: 'last'`.
   */
  async listTable(userId: string, req: TableRequest): Promise<TablePage<unknown>> {
    await this.assertCan(userId, P_READ_ALL, 'No tienes permiso para ver todos los tickets.');
    const { page, pageSize, skip, take } = tableSkipTake(req);

    const searchWhere = tableSearchWhere<Prisma.TicketWhereInput>(req.search, [
      'ticketNumber',
      'title',
      'requesterName',
      'module',
    ]);

    const filters = req.filters ?? {};
    const parts: Prisma.TicketWhereInput[] = [];
    const pick = (key: string): string =>
      typeof filters[key] === 'string' ? (filters[key] as string).trim() : '';
    // Los filtros llegan crudos del query string: se validan contra el enum para
    // degradar a "filtro ignorado" en vez de reventar la consulta con un 500.
    const status = pick('status');
    if ((Object.values(TicketStatus) as string[]).includes(status)) {
      parts.push({ status: status as TicketStatus });
    }
    const tipo = pick('type');
    if (tipo) parts.push({ type: tipo as never });
    const prioridad = pick('priority');
    if (prioridad) parts.push({ priority: prioridad as never });
    const via = pick('lane');
    if (via) parts.push({ lane: via as never });

    const where = tableAndWhere<Prisma.TicketWhereInput>(searchWhere, ...parts) ?? {};

    const orderBy = tableOrderBy<Prisma.TicketOrderByWithRelationInput[]>(
      req,
      {
        numero: (dir) => [{ ticketNumber: dir }, { id: 'desc' }],
        titulo: (dir) => [{ title: dir }, { id: 'desc' }],
        estado: (dir) => [{ status: dir }, { id: 'desc' }],
        prioridad: (dir) => [{ priority: dir }, { id: 'desc' }],
        enviado: (dir) => [{ submittedAt: dir }, { id: 'desc' }],
      },
      [{ slaTriageDueAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({ where, include: TICKET_INCLUDE, orderBy, skip, take }),
      this.prisma.ticket.count({ where }),
    ]);

    return tablePage(rows.map((row) => this.toView(row)), total, page, pageSize);
  }

  /** Contadores del panel: sin triage, SLA vencido y en curso. */
  async queueStats(userId: string): Promise<{ sinTriage: number; slaVencido: number; enCurso: number }> {
    await this.assertCan(userId, P_READ_ALL, 'No tienes permiso para ver todos los tickets.');
    const ahora = new Date();
    const [sinTriage, slaVencido, enCurso] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where: { status: TicketStatus.ENVIADO } }),
      // Vencido = sigue esperando triage y su plazo ya pasó.
      this.prisma.ticket.count({
        where: { status: TicketStatus.ENVIADO, slaTriageDueAt: { lt: ahora } },
      }),
      this.prisma.ticket.count({ where: { status: { in: EN_CURSO } } }),
    ]);
    return { sinTriage, slaVencido, enCurso };
  }

  /** Detalle con bitácora y las transiciones que ESTE usuario puede ejecutar. */
  async getById(userId: string, id: string): Promise<unknown> {
    const row = await this.prisma.ticket.findUnique({
      where: { id },
      include: { ...TICKET_INCLUDE, events: { orderBy: { at: 'asc' } } },
    });
    if (!row) throw new NotFoundException('El ticket no existe.');

    const esDueno = row.requesterId === userId;
    const puedeVerTodo = await this.can(userId, P_READ_ALL);
    if (!esDueno && !puedeVerTodo) {
      // Anti-enumeración: no se distingue "no existe" de "no es tuyo".
      throw new NotFoundException('El ticket no existe.');
    }

    const puedeTriage = await this.can(userId, P_TRIAGE);
    return {
      ...this.toView(row),
      events: row.events.map((e) => ({
        id: e.id,
        at: e.at.toISOString(),
        byId: e.byId,
        byName: e.byName,
        kind: e.kind,
        from: e.from,
        to: e.to,
        comment: e.comment,
      })),
      allowedTransitions: transitionsFrom(row.status)
        .filter((t) => (t.actor === 'IT' ? puedeTriage : esDueno || puedeTriage))
        .map((t) => ({ to: t.to, requiresComment: t.requiresComment === true })),
    };
  }

  // ── Escrituras ─────────────────────────────────────────────────────────────

  /**
   * Crea el ticket y lo deja ENVIADO. Todo ocurre en UNA transacción: el
   * correlativo, el ticket y el primer evento de la bitácora. Si algo falla no
   * queda ni un número quemado ni un ticket sin bitácora.
   */
  async create(userId: string, dto: CreateTicketDto): Promise<unknown> {
    await this.assertCan(userId, P_CREATE, 'No tienes permiso para levantar tickets.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!user) throw new NotFoundException('El usuario de la sesión ya no existe.');

    await this.assertExists('Department', dto.departmentId, 'El área indicada no existe.');
    if (dto.faenaId) await this.assertExists('Faena', dto.faenaId, 'La faena indicada no existe.');
    if (dto.projectId) await this.assertExists('Project', dto.projectId, 'El proyecto indicado no existe.');

    const requesterName = `${user.firstName} ${user.lastName}`.trim();
    const submittedAt = new Date();
    // El año del correlativo es el de CHILE, no el de UTC: un ticket enviado el
    // 31 de diciembre por la noche pertenece al año que ve el usuario.
    const year = santiagoDateParts(submittedAt).year;

    const created = await this.prisma.$transaction(async (tx) => {
      // Correlativo atómico: el INSERT ... ON CONFLICT resuelve la carrera de dos
      // envíos simultáneos (incluido el primero del año) sin bloquear la tabla.
      const rows = await tx.$queryRaw<Array<{ seq: number }>>`
        INSERT INTO ticket_counters (year, seq) VALUES (${year}, 1)
        ON CONFLICT (year) DO UPDATE SET seq = ticket_counters.seq + 1
        RETURNING seq
      `;
      const seq = rows[0]?.seq ?? 1;
      const ticketNumber = `TI-${year}-${String(seq).padStart(4, '0')}`;

      const ticket = await tx.ticket.create({
        data: {
          ticketNumber,
          type: dto.type,
          title: dto.title.trim(),
          status: TicketStatus.ENVIADO,
          requesterId: userId,
          requesterName,
          requesterEmail: user.email,
          departmentId: dto.departmentId,
          faenaId: dto.faenaId ?? null,
          projectId: dto.projectId ?? null,
          managerName: dto.managerName.trim(),
          managerAck: dto.managerAck,
          module: dto.module.trim(),
          expected: dto.expected.trim(),
          impact: dto.impact.trim(),
          peopleAffected: dto.peopleAffected,
          frequency: dto.frequency,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          milestone: dto.milestone?.trim() ?? '',
          submittedAt,
          slaTriageDueAt: slaTriageDueAt(submittedAt),
          lastEventAt: submittedAt,
        },
        include: TICKET_INCLUDE,
      });

      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          byId: userId,
          byName: requesterName,
          kind: 'STATUS',
          from: TicketStatus.BORRADOR,
          to: TicketStatus.ENVIADO,
          comment: '',
          at: submittedAt,
        },
      });

      return ticket;
    });

    return this.toView(created);
  }

  /** Clasificación del triage. No mueve el estado: eso es una transición aparte. */
  async triage(userId: string, id: string, dto: TriageTicketDto): Promise<unknown> {
    await this.assertCan(userId, P_TRIAGE, 'No tienes permiso para clasificar tickets.');
    if (dto.assignedToId) {
      await this.assertExists('User', dto.assignedToId, 'El responsable indicado no existe.');
    }

    const actor = await this.actorName(userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const actual = await tx.ticket.findUnique({ where: { id }, select: { status: true } });
      if (!actual) throw new NotFoundException('El ticket no existe.');
      if (actual.status === TicketStatus.CERRADO || actual.status === TicketStatus.RECHAZADO) {
        throw new ConflictException('El ticket ya está cerrado; no se puede reclasificar.');
      }

      const ticket = await tx.ticket.update({
        where: { id },
        data: {
          ...(dto.lane !== undefined ? { lane: dto.lane } : {}),
          ...(dto.size !== undefined ? { size: dto.size } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId } : {}),
          lastEventAt: new Date(),
        },
        include: TICKET_INCLUDE,
      });

      const detalle = [
        dto.lane !== undefined ? `vía ${dto.lane}` : null,
        dto.size !== undefined ? `tamaño ${dto.size}` : null,
        dto.priority !== undefined ? `prioridad ${dto.priority}` : null,
        dto.assignedToId !== undefined ? 'responsable asignado' : null,
      ].filter(Boolean).join(', ');

      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          byId: userId,
          byName: actor,
          kind: 'COMMENT',
          comment: detalle ? `Clasificación: ${detalle}.` : 'Clasificación actualizada.',
        },
      });

      return ticket;
    });

    return this.toView(updated);
  }

  /**
   * Ejecuta una transición de estado. Valida DENTRO de la transacción releyendo
   * el ticket: si otro usuario lo movió mientras tanto, falla en vez de pisar.
   */
  async transition(userId: string, id: string, dto: TransitionTicketDto): Promise<unknown> {
    const puedeTriage = await this.can(userId, P_TRIAGE);
    const actor = await this.actorName(userId);
    const comment = dto.comment?.trim() ?? '';

    const updated = await this.prisma.$transaction(async (tx) => {
      const actual = await tx.ticket.findUnique({
        where: { id },
        select: { status: true, requesterId: true, lane: true, size: true, priority: true },
      });
      if (!actual) throw new NotFoundException('El ticket no existe.');

      const rule = findTransition(actual.status, dto.to);
      if (!rule) {
        throw new ConflictException(
          `No se puede pasar de ${actual.status} a ${dto.to}. Puede que alguien más haya movido el ticket.`,
        );
      }

      // Quién puede: las de Informática exigen `ticket:triage`; las del
      // solicitante son suyas, y un admin puede hacerlas EN SU NOMBRE (decisión
      // de Juan). La bitácora registra quién fue realmente.
      const esDueno = actual.requesterId === userId;
      const autorizado = rule.actor === 'IT' ? puedeTriage : esDueno || puedeTriage;
      if (!autorizado) {
        throw new ForbiddenException('No tienes permiso para ejecutar esta transición.');
      }

      if (rule.requiresComment && comment.length === 0) {
        throw new BadRequestException('Esta acción exige un comentario que explique el motivo.');
      }
      if (rule.requiresClassification && (!actual.lane || !actual.size || !actual.priority)) {
        throw new BadRequestException(
          'Antes de aceptar el ticket debes fijar vía, tamaño y prioridad.',
        );
      }
      if (rule.requiresLaneProyecto && actual.lane !== 'PROYECTO') {
        throw new BadRequestException(
          'El levantamiento es solo para la vía Proyecto; la vía rápida se resuelve en el backlog.',
        );
      }

      const ahora = new Date();
      const ticket = await tx.ticket.update({
        where: { id },
        data: {
          status: dto.to,
          lastEventAt: ahora,
          ...(dto.to === TicketStatus.EN_TRIAGE && actual.status === TicketStatus.ENVIADO
            ? { triagedAt: ahora }
            : {}),
          ...(dto.to === TicketStatus.CERRADO ? { closedAt: ahora } : {}),
          ...(dto.to === TicketStatus.RECHAZADO ? { rejectionReason: comment, closedAt: ahora } : {}),
        },
        include: TICKET_INCLUDE,
      });

      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          byId: userId,
          byName: actor,
          kind: 'STATUS',
          from: actual.status,
          to: dto.to,
          comment,
          at: ahora,
        },
      });

      return ticket;
    });

    return this.toView(updated);
  }

  /** Comentario en la bitácora, sin cambiar de estado. */
  async comment(userId: string, id: string, dto: CommentTicketDto): Promise<{ ok: true }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { requesterId: true },
    });
    if (!ticket) throw new NotFoundException('El ticket no existe.');

    const esDueno = ticket.requesterId === userId;
    const puedeVerTodo = await this.can(userId, P_READ_ALL);
    if (!esDueno && !puedeVerTodo) throw new NotFoundException('El ticket no existe.');

    await this.prisma.ticketEvent.create({
      data: {
        ticketId: id,
        byId: userId,
        byName: await this.actorName(userId),
        kind: 'COMMENT',
        comment: dto.comment.trim(),
      },
    });
    await this.prisma.ticket.update({ where: { id }, data: { lastEventAt: new Date() } });
    return { ok: true };
  }

  // ── Apoyo ──────────────────────────────────────────────────────────────────

  private async can(userId: string, permissionKey: string): Promise<boolean> {
    return (await this.permissions.can(userId, permissionKey)).effect === 'allow';
  }

  private async assertCan(userId: string, permissionKey: string, mensaje: string): Promise<void> {
    if (!(await this.can(userId, permissionKey))) throw new ForbiddenException(mensaje);
  }

  private async actorName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.email : 'Usuario';
  }

  /** 400 con mensaje claro si la referencia no existe (en vez de un P2003 críptico). */
  private async assertExists(
    modelo: 'Department' | 'Faena' | 'Project' | 'User',
    id: string,
    mensaje: string,
  ): Promise<void> {
    const encontrado =
      modelo === 'Department'
        ? await this.prisma.department.findUnique({ where: { id }, select: { id: true } })
        : modelo === 'Faena'
          ? await this.prisma.faena.findUnique({ where: { id }, select: { id: true } })
          : modelo === 'Project'
            ? await this.prisma.project.findUnique({ where: { id }, select: { id: true } })
            : await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!encontrado) throw new BadRequestException(mensaje);
  }

  private toView(row: TicketRow) {
    return {
      id: row.id,
      ticketNumber: row.ticketNumber,
      type: row.type,
      title: row.title,
      status: row.status,
      requesterId: row.requesterId,
      requesterName: row.requesterName,
      requesterEmail: row.requesterEmail,
      department: row.department ? { id: row.department.id, name: row.department.name } : null,
      faena: row.faena ? { id: row.faena.id, name: row.faena.name } : null,
      project: row.project ? { id: row.project.id, name: row.project.name } : null,
      managerName: row.managerName,
      managerAck: row.managerAck,
      module: row.module,
      expected: row.expected,
      impact: row.impact,
      peopleAffected: row.peopleAffected,
      frequency: row.frequency,
      dueDate: row.dueDate?.toISOString() ?? null,
      milestone: row.milestone,
      attachmentUrls: row.attachmentUrls,
      lane: row.lane,
      size: row.size,
      priority: row.priority,
      assignedTo: row.assignedTo
        ? {
            id: row.assignedTo.id,
            name: `${row.assignedTo.firstName} ${row.assignedTo.lastName}`.trim(),
          }
        : null,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      triagedAt: row.triagedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      lastEventAt: row.lastEventAt?.toISOString() ?? null,
      slaTriageDueAt: row.slaTriageDueAt?.toISOString() ?? null,
    };
  }
}
