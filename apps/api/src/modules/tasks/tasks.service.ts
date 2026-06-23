import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TaskStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { GamificationService } from '../gamification/gamification.service';
import { PermissionService } from '../../authz/permission.service';
import { CreateTaskDto, UpdateTaskDto, UpdateTaskStatusDto } from './dto/tasks.dto';

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
   * Crea una nueva tarea en el backlog.
   */
  async create(userId: string, dto: CreateTaskDto) {
    // Verificar permisos FGA sobre el proyecto
    const canCreate = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_create_task',
      object: `project:${dto.projectId}`,
    });

    if (!canCreate) {
      throw new BadRequestException('No tienes permisos para crear tareas en este proyecto.');
    }

    const task = await this.prisma.task.create({
      data: {
        name: dto.name,
        description: dto.description,
        projectId: dto.projectId,
        serviceId: dto.serviceId || null,
        assignedToId: dto.assignedToId || null,
        createdById: userId,
        estimatedPoints: dto.estimatedPoints ?? 0,
        recurrence: dto.recurrence || null,
        clientUserId: dto.clientUserId || null,
        phaseId: dto.phaseId || null,
        elementId: dto.elementId || null,
        dataSpec: dto.dataSpec === undefined ? Prisma.JsonNull : (dto.dataSpec as Prisma.InputJsonValue),
        status: TaskStatus.PENDIENTE,
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

    return task;
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
    // 1. Resolver el scope vía la fachada de permisos (ADR-0001). null = denegado.
    const scope = await this.permissions.scopeFilter(userId, 'task:read');
    if (scope === null) {
      return [];
    }

    // 2. Construir la consulta where según el scope.
    const where: Prisma.TaskWhereInput = {};

    if (scope.kind === 'own') {
      // OWN: solo tareas que asignaron al usuario o que él creó.
      where.OR = [{ assignedToId: userId }, { createdById: userId }];
    } else if (scope.kind === 'projects') {
      // PROJECT: limitar a los proyectos asociados al usuario.
      where.projectId = { in: scope.ids };
    }
    // scope.kind === 'none' (GLOBAL): sin restricción de fila.

    if (filters.projectId) {
      // Un projectId del filtro solo se aplica si está dentro del scope permitido.
      if (scope.kind === 'projects' && !scope.ids.includes(filters.projectId)) {
        throw new BadRequestException('No tienes acceso a este proyecto.');
      }
      where.projectId = filters.projectId;
    }

    if (filters.serviceId) {
      where.serviceId = filters.serviceId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.assignedToId) {
      where.assignedToId = filters.assignedToId;
    }

    if (filters.search) {
      const search = [
        { name: { contains: filters.search, mode: 'insensitive' as const } },
        { description: { contains: filters.search, mode: 'insensitive' as const } },
      ];
      // Si el scope OWN ya ocupó `where.OR`, intersectar con AND para no ampliar el alcance.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: search }];
        delete where.OR;
      } else {
        where.OR = search;
      }
    }

    return this.prisma.task.findMany({
      where,
      include: {
        project: true,
        service: true,
        assignedTo: true,
        createdBy: true,
        clientUser: true,
        timeLogs: { orderBy: { startedAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
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

    // Verificar permisos FGA sobre el proyecto asociado
    const allowed = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_view',
      object: `project:${task.projectId}`,
    });

    if (!allowed) {
      throw new NotFoundException('La tarea no existe o no tienes acceso.');
    }

    return task;
  }

  /**
   * Modifica los datos de una tarea.
   */
  async update(id: string, userId: string, dto: UpdateTaskDto) {
    const task = await this.getById(id, userId);

    // Verificar permisos de asignación/modificación de tareas en el proyecto
    const canAssign = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_assign_task',
      object: `project:${task.projectId}`,
    });

    // Permitir cambios solo si es el creador, el asignado o tiene permiso de asignar en el proyecto
    if (!canAssign && task.createdById !== userId && task.assignedToId !== userId) {
      throw new BadRequestException('No tienes permiso para modificar esta tarea.');
    }

    return this.prisma.task.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        assignedToId: dto.assignedToId !== undefined ? dto.assignedToId : undefined,
        estimatedPoints: dto.estimatedPoints,
        actualPoints: dto.actualPoints,
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
  }

  /**
   * Mueve el estado de la tarea (Kanban) y otorga puntos de gamificación al completarse.
   */
  async updateStatus(id: string, userId: string, dto: UpdateTaskStatusDto) {
    const task = await this.getById(id, userId);

    // Permitir mover la tarea si tiene el permiso general o es el asignado de la tarea
    const canCreate = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_create_task',
      object: `project:${task.projectId}`,
    });

    if (!canCreate && task.assignedToId !== userId) {
      throw new BadRequestException('No tienes permiso para mover esta tarea.');
    }

    // Si la tarea se mueve a COMPLETADO, ejecutar en una transacción para actualizar puntos del usuario
    if (dto.status === TaskStatus.COMPLETADO && task.status !== TaskStatus.COMPLETADO) {
      const finalPoints = dto.actualPoints ?? task.estimatedPoints;

      const updatedTask = await this.prisma.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETADO,
          actualPoints: finalPoints,
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

      return updatedTask;
    }

    // Transición de estado normal (no completado)
    return this.prisma.task.update({
      where: { id },
      data: { status: dto.status },
      include: {
        project: true,
        service: true,
        assignedTo: true,
        createdBy: true,
        clientUser: true,
      },
    });
  }

  /**
   * Elimina una tarea.
   */
  async remove(id: string, userId: string) {
    const task = await this.getById(id, userId);

    const canAssign = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_assign_task',
      object: `project:${task.projectId}`,
    });

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
        projectId: task.projectId,
      });
      if (decision.effect !== 'allow') {
        throw new BadRequestException('No tienes permiso para registrar tiempo en esta tarea.');
      }
    }

    const open = await this.prisma.taskTimeLog.findFirst({
      where: { taskId: id, userId, endedAt: null },
    });
    if (open) {
      throw new BadRequestException('Ya hay una actividad en curso para esta tarea.');
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
        projectId: task.projectId,
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
