import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TaskStatus, TaskPriority, Prisma } from '@prisma/client';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { GamificationService } from '../gamification/gamification.service';
import { PermissionService } from '../../authz/permission.service';
import { tableOrderBy, tablePage, tableSkipTake } from '../../common/table-pagination.util';
import { CreateTaskDto, UpdateTaskDto, UpdateTaskStatusDto } from './dto/tasks.dto';
import { computeTaskPriority } from './priority.util';

/** Include común de las consultas de tareas (misma forma para list y listTable). */
const TASK_INCLUDE = {
  project: true,
  service: true,
  assignedTo: true,
  createdBy: true,
  clientUser: true,
  timeLogs: { orderBy: { startedAt: 'asc' as const } },
} satisfies Prisma.TaskInclude;

/** Estados válidos de tarea (whitelist del filtro de estado de la tabla). */
const VALID_TASK_STATUSES: readonly string[] = ['PENDIENTE', 'EN_PROGRESO', 'REVISADO', 'COMPLETADO'];

/**
 * Estrecha un valor de query a string no vacío ('all' = sin filtro). NO confiar en
 * el tipo declarado: el query parser entrega lo que mande el cliente, y con el
 * parser extendido `?serviceId[x]=1` llega como objeto y `?serviceId=a&serviceId=b`
 * como arreglo. Sin estrechar, eso viaja tal cual al `where` de Prisma y revienta
 * en 500 (o aplicaría un operador que la API no expone).
 */
const asQueryString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() && value !== 'all' ? value.trim() : undefined;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    private readonly gamification: GamificationService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Helper que computa la prioridad al leer, actualiza los objetos devueltos,
   * y lanza un lazy update a BD para mantener los índices sincronizados.
   */
  private applyPriorityEscalation<T extends { id: string; priority: TaskPriority; priorityManual: boolean; dueDate: Date | null }>(tasks: T[]): T[] {
    const now = new Date();

    const result = tasks.map((t) => {
      const computed = computeTaskPriority(t.priority, t.priorityManual, t.dueDate, now);
      return { ...t, priority: computed };
    });

    // Removida la actualización en BD desde el camino de lectura (QA).
    // Esto previene side-effects (UPDATEs no esperados al listar).

    return result;
  }

  /**
   * Crea una nueva tarea en el backlog.
   */
  async create(userId: string, dto: CreateTaskDto) {
    if (dto.projectId) {
      // Verificar permisos FGA sobre el proyecto
      const canCreate = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_create_task',
        object: `project:${dto.projectId}`,
      });

      if (!canCreate) {
        throw new BadRequestException('No tienes permisos para crear tareas en este proyecto.');
      }
    } else {
      // Tarea suelta: requiere permiso funcional global (ej. desde Operaciones)
      const filter = await this.permissions.scopeFilter(userId, 'task:create');
      if (!filter || filter.kind !== 'none') {
        throw new BadRequestException('No tienes permisos para crear tareas sueltas (se requiere acceso GLOBAL a tareas).');
      }
    }

    if (dto.parentId) {
      const parent = await this.getById(dto.parentId, userId);
      if ((parent.projectId || null) !== (dto.projectId || null)) {
        throw new BadRequestException('La tarea padre debe pertenecer al mismo proyecto (o ambas sueltas).');
      }
    }

    const priorityManual = dto.priority !== undefined ? true : (dto.priorityManual || false);

    const task = await this.prisma.task.create({
      data: {
        name: dto.name,
        description: dto.description,
        projectId: dto.projectId || null,
        parentId: dto.parentId || null,
        priority: dto.priority || 'BAJA',
        type: dto.type || 'SPOT',
        priorityManual: priorityManual,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        serviceId: dto.serviceId || null,
        assignedToId: dto.assignedToId || null,
        createdById: userId,
        estimatedPoints: dto.estimatedPoints ?? 0,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        recurrence: dto.recurrence || null,
        clientUserId: dto.clientUserId || null,
        phaseId: dto.phaseId || null,
        elementId: dto.elementId || null,
        dataSpec: dto.dataSpec === undefined ? Prisma.JsonNull : (dto.dataSpec as Prisma.InputJsonValue),
        status: TaskStatus.PENDIENTE,
        children: dto.steps && dto.steps.length > 0 ? {
          create: dto.steps.map((step) => {
            const stepPriorityManual = step.priority !== undefined;
            return {
              name: step.name,
              description: step.description,
              projectId: dto.projectId || null,
              type: dto.type || 'SPOT',
              priority: step.priority ?? 'BAJA',
              priorityManual: stepPriorityManual,
              startDate: step.startDate ? new Date(step.startDate) : null,
              serviceId: dto.serviceId || null,
              assignedToId: step.assignedToId || dto.assignedToId || null,
              createdById: userId,
              estimatedPoints: 0,
              reviewDate: step.reviewDate ? new Date(step.reviewDate) : null,
              dueDate: step.dueDate ? new Date(step.dueDate) : null,
              recurrence: dto.recurrence || null,
              clientUserId: dto.clientUserId || null,
              phaseId: dto.phaseId || null,
              elementId: dto.elementId || null,
              dataSpec: step.dataSpec === undefined ? Prisma.JsonNull : (step.dataSpec as Prisma.InputJsonValue),
              status: TaskStatus.PENDIENTE,
            };
          }),
        } : undefined,
      },
      include: {
        project: true,
        service: true,
        assignedTo: true,
        createdBy: true,
        clientUser: true,
      },
    });

    // Gamificación: puntos por crear tarea (best-effort)
    void this.gamification.awardPoints(userId, 'CREATE_TASK');

    return this.applyPriorityEscalation([task])[0];
  }

  /**
   * Lista las tareas visibles para el usuario.
   */
  async list(
    userId: string,
    filters: {
      projectId?: string;
      serviceId?: string;
      status?: TaskStatus;
      assignedToId?: string;
      search?: string;
    },
  ) {
    const where = await this.buildTaskWhere(userId, filters);
    if (where === null) {
      return [];
    }
    const rows = await this.prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return this.applyPriorityEscalation(rows);
  }

  /**
   * Lista tareas con el MOTOR de tablas server-side (offset). Reusa el MISMO
   * `where` (scope task:read + filtros + búsqueda) que el keyset `list`, pero
   * devuelve una página numerada + total con orden configurable (nombre/estado/
   * puntos/creado, default creado desc). Lo consume la vista Tabla del Backlog
   * (el Kanban sigue con carga completa vía `list`). Los filtros llegan en
   * `req.filters` (project/service/assignee/status), validados/mapeados aquí.
   */
  async listTable(userId: string, req: TableRequest): Promise<TablePage<unknown>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);
    const f = req.filters ?? {};

    // El estrechamiento (string / enum) lo hace `buildTaskWhere`, que es el punto
    // común con la lista keyset. Aquí solo se mapean los nombres de filtro de la
    // tabla y su regla propia: 'unassigned' (como 'all') no filtra.
    const where = await this.buildTaskWhere(userId, {
      projectId: f.project,
      serviceId: f.service,
      assignedToId: asQueryString(f.assignee) === 'unassigned' ? undefined : f.assignee,
      status: f.status,
      search: req.search,
    });
    if (where === null) {
      return tablePage([], 0, page, pageSize);
    }

    const orderBy = tableOrderBy<Prisma.TaskOrderByWithRelationInput[]>(
      req,
      {
        tarea: (dir) => [{ name: dir }, { id: 'desc' }],
        estado: (dir) => [{ status: dir }, { createdAt: 'desc' }, { id: 'desc' }],
        estimado: (dir) => [{ estimatedPoints: dir }, { createdAt: 'desc' }, { id: 'desc' }],
        real: (dir) => [{ actualPoints: dir }, { createdAt: 'desc' }, { id: 'desc' }],
        creado: (dir) => [{ createdAt: dir }, { id: 'desc' }],
      },
      [{ createdAt: 'desc' }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy, skip, take }),
      this.prisma.task.count({ where }),
    ]);

    return tablePage(this.applyPriorityEscalation(rows), total, page, pageSize);
  }

  /**
   * Arma el `where` de la lista de tareas: scope funcional task:read (ADR-0001,
   * OWN / projects / GLOBAL) + filtros project/service/status/assignee + búsqueda
   * (nombre/descripción, intersectada con AND si el scope OWN ya ocupó el OR).
   * Devuelve `null` si el scope deniega el acceso. Compartido por `list` (keyset)
   * y `listTable` (offset) para aplicar exactamente el mismo filtrado.
   */
  private async buildTaskWhere(
    userId: string,
    // `unknown` a propósito: estos valores vienen de la query y NO están tipados de
    // verdad (el cliente manda lo que quiera). Se estrechan aquí, que es el punto
    // común de la lista keyset y la de tabla.
    filters: {
      projectId?: unknown;
      serviceId?: unknown;
      status?: unknown;
      assignedToId?: unknown;
      search?: unknown;
    },
  ): Promise<Prisma.TaskWhereInput | null> {
    const scope = await this.permissions.scopeFilter(userId, 'task:read');
    if (scope === null) {
      return null;
    }

    const where: Prisma.TaskWhereInput = {};

    if (scope.kind === 'own') {
      where.OR = [{ assignedToId: userId }, { createdById: userId }];
    } else if (scope.kind === 'projects') {
      // Los proyectos del scope, Y las tareas sueltas propias (donde no aplica proyecto)
      where.OR = [
        { projectId: { in: scope.ids } },
        { projectId: null, assignedToId: userId },
        { projectId: null, createdById: userId },
      ];
    }
    // scope.kind === 'none' (GLOBAL): sin restricción de fila.

    const projectId = asQueryString(filters.projectId);
    if (projectId) {
      if (scope.kind === 'projects' && !scope.ids.includes(projectId)) {
        throw new BadRequestException('No tienes acceso a este proyecto.');
      }
      where.projectId = projectId;
    }

    const serviceId = asQueryString(filters.serviceId);
    if (serviceId) {
      where.serviceId = serviceId;
    }

    // El estado además debe pertenecer al enum: un valor libre no filtra (en vez de
    // colarse como operador o reventar la consulta).
    const status = asQueryString(filters.status);
    if (status && VALID_TASK_STATUSES.includes(status)) {
      where.status = status as TaskStatus;
    }

    const assignedToId = asQueryString(filters.assignedToId);
    if (assignedToId) {
      where.assignedToId = assignedToId;
    }

    const search = asQueryString(filters.search) ?? '';
    if (search.length > 0) {
      const searchOr = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { description: { contains: search, mode: 'insensitive' as const } },
      ];
      // Si el scope OWN ya ocupó `where.OR`, intersectar con AND para no ampliar el alcance.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchOr }];
        delete where.OR;
      } else {
        where.OR = searchOr;
      }
    }

    return where;
  }

  /**
   * Determina si un usuario puede operar una tarea suelta.
   * Una tarea suelta (projectId = null) solo puede ser operada por:
   * - Usuario con alcance GLOBAL (ej. Administrador de Operaciones)
   * - El creador de la propia tarea
   */
  private async canOperateStandaloneTask(task: { createdById: string }, userId: string, permissionKey: string): Promise<boolean> {
    const filter = await this.permissions.scopeFilter(userId, permissionKey);
    if (!filter) return false;
    if (filter.kind === 'none') return true;
    if (task.createdById === userId) return true;
    return false;
  }

  /**
   * Obtiene el detalle de una tarea por ID.
   */
  async getById(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        project: true,
        service: true,
        assignedTo: true,
        createdBy: true,
        clientUser: true,
        timeLogs: { orderBy: { startedAt: 'asc' } },
      },
    });

    if (!task) {
      throw new NotFoundException('La tarea no existe.');
    }

    // Validar acceso con PermissionService (que maneja tanto proyectos como tareas sueltas)
    const decision = await this.permissions.can(userId, 'task:read', {
      projectId: task.projectId || undefined,
      createdById: task.createdById,
    });
    
    let allowed = decision.effect === 'allow';
    
    // Atajo para asignados en tareas sueltas (ya que el PermissionService no mira assignedToId)
    if (!task.projectId && !allowed && decision.filter.kind !== 'none') {
      if (task.assignedToId === userId) allowed = true;
    }

    if (!allowed) {
      throw new NotFoundException('La tarea no existe o no tienes acceso.');
    }

    return this.applyPriorityEscalation([task])[0]!;
  }

  /**
   * Modifica los datos de una tarea.
   */
  async update(id: string, userId: string, dto: UpdateTaskDto) {
    const task = await this.getById(id, userId);

    // Verificar permisos de asignación/modificación de tareas en el proyecto
    let canAssign = false;
    if (task.projectId) {
      canAssign = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_assign_task',
        object: `project:${task.projectId}`,
      });
    } else {
      canAssign = await this.canOperateStandaloneTask(task, userId, 'task:update');
    }

    // Permitir cambios solo si es el creador, el asignado o tiene permiso de asignar en el proyecto
    if (!canAssign && task.createdById !== userId && task.assignedToId !== userId) {
      throw new BadRequestException('No tienes permiso para modificar esta tarea.');
    }

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('Una tarea no puede ser padre de sí misma.');
      }
      if (dto.parentId !== null) {
        const parent = await this.getById(dto.parentId, userId);
        if ((parent.projectId || null) !== (task.projectId || null)) {
          throw new BadRequestException('La tarea padre debe pertenecer al mismo proyecto (o ambas sueltas).');
        }
        // Detección de ciclos indirectos: recorre ancestros del padre propuesto.
        // Si encontramos `id` en la cadena, aceptar crearía un ciclo.
        const MAX_ANCESTOR_DEPTH = 20;
        let cursor: string | null = parent.parentId ?? null;
        for (let depth = 0; cursor && depth < MAX_ANCESTOR_DEPTH; depth++) {
          if (cursor === id) {
            throw new BadRequestException('El parentId crea un ciclo en la jerarquía de tareas.');
          }
          const ancestor = await this.prisma.task.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
          cursor = ancestor?.parentId ?? null;
        }
      }
    }

    let priorityManual = dto.priorityManual;
    if (dto.priority !== undefined) {
      priorityManual = true;
    }

    const updatedTask = await this.prisma.task.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId !== undefined ? dto.parentId : undefined,
        priority: dto.priority !== undefined ? dto.priority : undefined,
        type: dto.type !== undefined ? dto.type : undefined,
        priorityManual: priorityManual !== undefined ? priorityManual : undefined,
        startDate: dto.startDate !== undefined ? (dto.startDate ? new Date(dto.startDate) : null) : undefined,
        assignedToId: dto.assignedToId !== undefined ? dto.assignedToId : undefined,
        estimatedPoints: dto.estimatedPoints,
        actualPoints: dto.actualPoints,
        // Fechas (#76): `undefined` deja intacto; `null` o "" limpia la fecha; ISO válido la fija.
        reviewDate: dto.reviewDate !== undefined ? (dto.reviewDate ? new Date(dto.reviewDate) : null) : undefined,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        recurrence: dto.recurrence,
        clientUserId: dto.clientUserId,
      },
      include: {
        project: true,
        service: true,
        assignedTo: true,
        createdBy: true,
        clientUser: true,
      },
    });

    return this.applyPriorityEscalation([updatedTask])[0]!;
  }

  /**
   * Mueve el estado de la tarea (Kanban) y otorga puntos de gamificación al completarse.
   */
  async updateStatus(id: string, userId: string, dto: UpdateTaskStatusDto) {
    const task = await this.getById(id, userId);

    // Autoridad: se resuelve UNA vez y se reusa en ambas compuertas para no
    // desalinearlas. Quien GESTIONA la tarea = su creador o can_assign_task
    // (supervisor / admin de contrato / gerencia). can_create_task es la puerta
    // general de mover; ser gestión también habilita (un rol custom con solo
    // task:assign es gestión legítima aunque no tenga task:create).
    let canCreate = false;
    let canAssign = false;
    if (task.projectId) {
      const results = await Promise.all([
        this.fga.check({ user: `user:${userId}`, relation: 'can_create_task', object: `project:${task.projectId}` }),
        this.fga.check({ user: `user:${userId}`, relation: 'can_assign_task', object: `project:${task.projectId}` }),
      ]);
      canCreate = results[0];
      canAssign = results[1];
    } else {
      const [createOk, assignOk] = await Promise.all([
        this.canOperateStandaloneTask(task, userId, 'task:create'),
        this.canOperateStandaloneTask(task, userId, 'task:update')
      ]);
      canCreate = createOk;
      canAssign = assignOk;
    }
    const isManager = task.createdById === userId || canAssign;

    if (!canCreate && !isManager && task.assignedToId !== userId) {
      throw new BadRequestException('No tienes permiso para mover esta tarea.');
    }

    // Revisión (#77): las transiciones de CONTROL solo las hace quien GESTIONA el
    // proyecto, NO el propio responsable:
    //  - APROBAR: cualquier movimiento HACIA COMPLETADO.
    //  - RECHAZAR / retirar de revisión: cualquier salida DE REVISADO.
    //  - REABRIR: cualquier salida DE COMPLETADO (deshace una aprobación).
    // El responsable solo mueve PENDIENTE→EN_PROGRESO (reportar inicio) y
    // EN_PROGRESO→REVISADO (enviar a revisión).
    const isApproval = dto.status === TaskStatus.COMPLETADO && task.status !== TaskStatus.COMPLETADO;
    const isRejection = task.status === TaskStatus.REVISADO && dto.status === TaskStatus.EN_PROGRESO;
    const requiresManagement =
      task.status !== dto.status &&
      (dto.status === TaskStatus.COMPLETADO ||
        task.status === TaskStatus.REVISADO ||
        task.status === TaskStatus.COMPLETADO);
    if (requiresManagement && !isManager) {
      throw new ForbiddenException(
        'Solo quien gestiona el proyecto puede aprobar, rechazar o reabrir la tarea.',
      );
    }

    // Motivo de rechazo (#77): rechazar lo guarda; reenviar a revisión o reiniciar
    // (PENDIENTE) lo limpian; el resto de transiciones no lo tocan (`undefined`).
    let rejectionReason: string | null | undefined = undefined;
    if (isRejection) rejectionReason = dto.rejectionReason ?? null;
    else if (dto.status === TaskStatus.REVISADO || dto.status === TaskStatus.PENDIENTE) {
      rejectionReason = null;
    }

    // Si la tarea se mueve a COMPLETADO, ejecutar en una transacción para actualizar puntos del usuario
    if (isApproval) {
      const finalPoints = dto.actualPoints ?? task.estimatedPoints;

      const updatedTask = await this.prisma.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETADO,
          actualPoints: finalPoints,
          rejectionReason: null, // aprobada: se limpia cualquier motivo previo
        },
        include: {
          project: true,
          service: true,
          assignedTo: true,
          createdBy: true,
          clientUser: true,
        },
      });

      // Gamificación: otorgar puntos al asignado por completar tarea (best-effort)
      if (task.assignedToId) {
        void this.gamification.awardPoints(task.assignedToId, 'COMPLETE_TASK');
      }

      return this.applyPriorityEscalation([updatedTask])[0]!;
    }

    // Transición de estado normal (no completado)
    const updatedTask = await this.prisma.task.update({
      where: { id },
      data: { status: dto.status, rejectionReason },
      include: {
        project: true,
        service: true,
        assignedTo: true,
        createdBy: true,
        clientUser: true,
      },
    });
    return this.applyPriorityEscalation([updatedTask])[0]!;
  }

  /**
   * Elimina una tarea.
   */
  async remove(id: string, userId: string) {
    const task = await this.getById(id, userId);

    let canAssign = false;
    if (task.projectId) {
      canAssign = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_assign_task',
        object: `project:${task.projectId}`,
      });
    } else {
      canAssign = await this.canOperateStandaloneTask(task, userId, 'task:update');
    }

    if (!canAssign && task.createdById !== userId) {
      throw new BadRequestException('No tienes permiso para eliminar esta tarea.');
    }

    return this.prisma.task.delete({
      where: { id },
    });
  }

  /**
   * Inicia una actividad (time-log) sobre la tarea para el operador en sesión.
   * Rechaza si ya existe un log abierto (endedAt = null) para (tarea, usuario).
   */
  async startTime(id: string, userId: string, note?: string) {
    const task = await this.getById(id, userId);

    // Autorización: el asignado puede registrar tiempo; cualquier otro requiere task:time:log.
    if (task.assignedToId !== userId) {
      const decision = await this.permissions.can(userId, 'task:time:log', {
        projectId: task.projectId ?? undefined,
      });
      if (decision.effect !== 'allow') {
        throw new BadRequestException('No tienes permiso para registrar tiempo en esta tarea.');
      }
    }

    // Lock de concurrencia (Módulo 5): una sola actividad activa por tarea.
    // Si ya hay un log abierto de OTRO operador, solo ese puede cerrarla (regla acompañante).
    const openAny = await this.prisma.taskTimeLog.findFirst({
      where: { taskId: id, endedAt: null },
    });
    if (openAny) {
      if (openAny.userId === userId) {
        throw new BadRequestException('Ya tienes una actividad en curso para esta tarea.');
      }
      throw new BadRequestException(
        'La actividad ya fue iniciada por otro operador; solo quien la inició puede cerrarla.',
      );
    }

    return this.prisma.taskTimeLog.create({
      data: {
        taskId: id,
        userId,
        startedAt: new Date(),
        note: note ?? null,
      },
    });
  }

  /**
   * Finaliza la actividad en curso (time-log abierto) del operador sobre la tarea.
   * Rechaza si no hay ninguna actividad abierta.
   */
  async finishTime(id: string, userId: string, note?: string) {
    const task = await this.getById(id, userId);

    if (task.assignedToId !== userId) {
      const decision = await this.permissions.can(userId, 'task:time:log', {
        projectId: task.projectId ?? undefined,
      });
      if (decision.effect !== 'allow') {
        throw new BadRequestException('No tienes permiso para registrar tiempo en esta tarea.');
      }
    }

    const open = await this.prisma.taskTimeLog.findFirst({
      where: { taskId: id, userId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!open) {
      // Lock de concurrencia: si la inició otro operador, solo ese puede cerrarla.
      const openOther = await this.prisma.taskTimeLog.findFirst({ where: { taskId: id, endedAt: null } });
      if (openOther) {
        throw new BadRequestException('Solo el operador que inició la actividad puede cerrarla.');
      }
      throw new BadRequestException('No hay una actividad en curso.');
    }

    return this.prisma.taskTimeLog.update({
      where: { id: open.id },
      data: {
        endedAt: new Date(),
        note: note !== undefined ? note : undefined,
      },
    });
  }

  /**
   * Devuelve los usuarios asignables (que pueden ver/ejecutar tareas) en un proyecto.
   * Requiere que el solicitante pueda ver el proyecto (can_view / task:read).
   */
  async getAssignees(projectId: string, userId: string) {
    const decision = await this.permissions.can(userId, 'task:read', { projectId });
    if (decision.effect !== 'allow') {
      throw new BadRequestException('No tienes acceso a este proyecto.');
    }

    const ids = await this.permissions.usersWithPermissionOnProject('task:read', projectId);
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }
}
