import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TaskStatus, ScopeType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { CreateTaskDto, UpdateTaskDto, UpdateTaskStatusDto } from './dto/tasks.dto';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
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

    return this.prisma.task.create({
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
    // 1. Obtener los proyectos permitidos del usuario
    const globalAdmin = await this.prisma.membership.findFirst({
      where: {
        userId,
        roleKey: 'org_admin',
        scopeType: ScopeType.ORGANIZATION,
      },
    });

    let allowedProjectIds: string[] | undefined;

    if (!globalAdmin) {
      const memberships = await this.prisma.membership.findMany({
        where: {
          userId,
          scopeType: { in: [ScopeType.PROJECT, ScopeType.DEPARTMENT] },
        },
      });

      const projectIds = memberships
        .filter((m) => m.scopeType === ScopeType.PROJECT)
        .map((m) => m.scopeId);

      const departmentIds = memberships
        .filter((m) => m.scopeType === ScopeType.DEPARTMENT)
        .map((m) => m.scopeId);

      const projects = await this.prisma.project.findMany({
        where: {
          OR: [
            { id: { in: projectIds } },
            { departmentId: { in: departmentIds } },
          ],
        },
        select: { id: true },
      });

      allowedProjectIds = projects.map((p) => p.id);
    }

    // 2. Construir la consulta where
    const where: Prisma.TaskWhereInput = {};

    if (allowedProjectIds) {
      where.projectId = { in: allowedProjectIds };
    }

    if (filters.projectId) {
      // Si el filtro específico se proporciona, validar que esté en los permitidos
      if (allowedProjectIds && !allowedProjectIds.includes(filters.projectId)) {
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
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.task.findMany({
      where,
      include: {
        project: true,
        service: true,
        assignedTo: true,
        createdBy: true,
        clientUser: true,
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

      return this.prisma.$transaction(async (tx) => {
        // 1. Actualizar la tarea
        const updatedTask = await tx.task.update({
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

        // 2. Si hay un usuario asignado, otorgar puntos de gamificación
        if (task.assignedToId) {
          await tx.user.update({
            where: { id: task.assignedToId },
            data: {
              points: { increment: finalPoints },
            },
          });
        }

        return updatedTask;
      });
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
}
