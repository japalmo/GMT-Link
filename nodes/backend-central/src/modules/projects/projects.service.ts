import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ScopeType, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import {
  CreateAssignmentDto,
  CreateProjectDto,
  CreateServiceDto,
  UpdateAssignmentDto,
  UpdateProjectKpisDto,
  UpdateServiceFrequencyDto,
} from './dto/projects.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
  ) {}

  /**
   * Crea un proyecto. Registra el proyecto en Postgres y crea una Membership
   * para el creador del proyecto con el rol `project_creator`, sincronizándolo a FGA.
   */
  async create(userId: string, dto: CreateProjectDto) {
    // Verificar si ya existe un código de proyecto idéntico en el departamento
    const existing = await this.prisma.project.findFirst({
      where: {
        departmentId: dto.departmentId,
        code: dto.code.toUpperCase(),
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya existe un proyecto con el código "${dto.code}" en este departamento.`,
      );
    }

    // Validar referencias opcionales antes de abrir la transacción.
    if (dto.faenaId) {
      const faena = await this.prisma.faena.findUnique({ where: { id: dto.faenaId } });
      if (!faena) {
        throw new BadRequestException('La faena indicada no existe.');
      }
      if (faena.clientId !== dto.clientId) {
        throw new BadRequestException('La faena no pertenece al cliente del proyecto.');
      }
    }
    if (dto.projectAdminId) {
      const admin = await this.prisma.user.findUnique({
        where: { id: dto.projectAdminId },
        select: { id: true },
      });
      if (!admin) {
        throw new BadRequestException('El administrador de proyecto indicado no existe.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Crear el proyecto
      const project = await tx.project.create({
        data: {
          code: dto.code.toUpperCase(),
          name: dto.name,
          description: dto.description ?? null,
          departmentId: dto.departmentId,
          clientId: dto.clientId,
          contractNumber: dto.contractNumber ?? null,
          projectType: dto.projectType ?? null,
          faenaId: dto.faenaId ?? null,
          projectAdminId: dto.projectAdminId ?? null,
          kpis: {},
        },
      });

      // 2. Crear la membresía de project_creator para el creador
      await tx.membership.create({
        data: {
          userId,
          roleKey: 'project_creator',
          scopeType: ScopeType.PROJECT,
          scopeId: project.id,
        },
      });

      // 3. Sincronizar membresía a OpenFGA
      await this.fga.syncMembershipToFGA(
        {
          userId,
          roleKey: 'project_creator',
          scopeType: ScopeType.PROJECT,
          scopeId: project.id,
        },
        'create',
      );

      // 4. Escribir relaciones estructurales en OpenFGA
      await this.fga.writeTuples([
        {
          user: `department:${project.departmentId}`,
          relation: 'department',
          object: `project:${project.id}`,
        },
        {
          user: `client:${project.clientId}`,
          relation: 'client',
          object: `project:${project.id}`,
        },
      ]);

      return this.injectCurrentKpi(project);
    });
  }

  /**
   * Lista todos los proyectos.
   * Filtra por visibilidad:
   *  - Si es org_admin, ve todos.
   *  - Si no, ve proyectos donde tenga membresía directa (PROJECT) o indirecta (DEPARTMENT).
   */
  async listAll(userId: string, faenaId?: string) {
    // 1. Verificar si es administrador global
    const globalAdmin = await this.prisma.membership.findFirst({
      where: {
        userId,
        roleKey: 'org_admin',
        scopeType: ScopeType.ORGANIZATION,
      },
    });

    if (globalAdmin) {
      const projects = await this.prisma.project.findMany({
        where: faenaId ? { faenaId } : {},
        include: {
          department: true,
          client: true,
          services: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return Promise.all(projects.map((p) => this.injectCurrentKpi(p)));
    }

    // 2. Si no es admin global, leer sus membresías de proyecto y departamento
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

    const accessClause = {
      OR: [
        { id: { in: projectIds } },
        { departmentId: { in: departmentIds } },
      ],
    };
    const projects = await this.prisma.project.findMany({
      // Solo envolvemos en AND cuando hay filtro por faena; sin filtro,
      // la cláusula de acceso queda tal cual (evita cambiar la forma del where).
      where: faenaId ? { AND: [accessClause, { faenaId }] } : accessClause,
      include: {
        department: true,
        client: true,
        services: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(projects.map((p) => this.injectCurrentKpi(p)));
  }

  /**
   * Obtiene un proyecto por ID y valida acceso con OpenFGA.
   */
  async getById(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        department: true,
        client: true,
        services: true,
      },
    });

    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }

    // Check visibility via OpenFGA (project can_view relation)
    const allowed = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_view',
      object: `project:${projectId}`,
    });

    if (!allowed) {
      throw new NotFoundException('El proyecto no existe o no tienes acceso.');
    }

    return this.injectCurrentKpi(project);
  }

  /**
   * Crea un servicio dentro del proyecto.
   */
  async createService(projectId: string, dto: CreateServiceDto, userId: string) {
    // Validar acceso para modificar proyecto
    const canCreate = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_create_service',
      object: `project:${projectId}`,
    });
    if (!canCreate) {
      throw new BadRequestException('No tienes permisos para crear servicios en este proyecto.');
    }

    const existing = await this.prisma.service.findFirst({
      where: {
        projectId,
        code: dto.code.toUpperCase(),
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya existe un servicio con el código "${dto.code}" en este proyecto.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.service.create({
        data: {
          code: dto.code.toUpperCase(),
          name: dto.name,
          projectId,
          docCodingConfig: dto.docCodingConfig,
        },
      });

      await this.fga.writeTuples([
        {
          user: `project:${projectId}`,
          relation: 'project',
          object: `service:${service.id}`,
        },
      ]);

      return service;
    });
  }

  /**
   * Configura los KPIs de un proyecto (JSONB).
   */
  async updateKpis(projectId: string, dto: UpdateProjectKpisDto, userId: string) {
    const canDefine = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_define_kpi',
      object: `project:${projectId}`,
    });
    if (!canDefine) {
      throw new BadRequestException('No tienes permisos para definir KPIs en este proyecto.');
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { kpis: dto.kpis },
    });
    return this.injectCurrentKpi(updated);
  }

  /**
   * Obtiene todos los departamentos disponibles.
   */
  async listDepartments() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Obtiene todos los clientes disponibles.
   */
  async listClients() {
    return this.prisma.client.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Usuarios elegibles como administrador de proyecto.
   * Se listan los usuarios internos ACTIVOS (no usuarios de cliente): el admin
   * de proyecto es un rol interno de GMT. El gate de acceso al endpoint lo pone
   * el controller (project:create).
   */
  async listEligibleAdmins() {
    return this.prisma.user.findMany({
      where: { isClientUser: false, status: { not: 'SUSPENDED' } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  /** Setea la frecuencia de un servicio del proyecto. */
  async setServiceFrequency(projectId: string, serviceId: string, dto: UpdateServiceFrequencyDto) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.projectId !== projectId) {
      throw new NotFoundException('El servicio no existe en este proyecto.');
    }
    return this.prisma.service.update({
      where: { id: serviceId },
      data: { frequency: dto.frequency },
    });
  }

  // ── Asignación de trabajadores a proyecto ──────────────────────────────────

  async listAssignments(projectId: string) {
    await this.assertProjectExists(projectId);
    return this.prisma.projectWorkerAssignment.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Asigna un trabajador al proyecto (persistencia en Postgres).
   * TODO(FGA): materializar la tupla funcional del rol asignado sobre el
   * proyecto (p. ej. (user:U, operator, project:P)) cuando se defina el mapeo
   * roleKey→relación FGA de trabajadores. Por ahora la autorización de acceso
   * a datos se resuelve vía Membership/roles existentes.
   */
  async createAssignment(projectId: string, dto: CreateAssignmentDto) {
    await this.assertProjectExists(projectId);
    await this.assertUserExists(dto.userId);

    const existing = await this.prisma.projectWorkerAssignment.findFirst({
      where: { projectId, userId: dto.userId, roleKey: dto.roleKey },
    });
    if (existing) {
      throw new BadRequestException('El trabajador ya está asignado con ese rol en el proyecto.');
    }

    return this.prisma.projectWorkerAssignment.create({
      data: {
        projectId,
        userId: dto.userId,
        roleKey: dto.roleKey,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async updateAssignment(projectId: string, assignmentId: string, dto: UpdateAssignmentDto) {
    const assignment = await this.getAssignmentInProject(projectId, assignmentId);

    // El cambio de roleKey no debe colisionar con otra asignación del mismo
    // usuario en el proyecto (@@unique([projectId, userId, roleKey])).
    if (dto.roleKey && dto.roleKey !== assignment.roleKey) {
      const clash = await this.prisma.projectWorkerAssignment.findFirst({
        where: { projectId, userId: assignment.userId, roleKey: dto.roleKey },
      });
      if (clash) {
        throw new BadRequestException('El trabajador ya está asignado con ese rol en el proyecto.');
      }
    }

    return this.prisma.projectWorkerAssignment.update({
      where: { id: assignmentId },
      data: {
        status: dto.status,
        roleKey: dto.roleKey,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async removeAssignment(projectId: string, assignmentId: string) {
    await this.getAssignmentInProject(projectId, assignmentId);
    await this.prisma.projectWorkerAssignment.delete({ where: { id: assignmentId } });
    return { success: true };
  }

  private async getAssignmentInProject(projectId: string, assignmentId: string) {
    const assignment = await this.prisma.projectWorkerAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.projectId !== projectId) {
      throw new NotFoundException('La asignación no existe en este proyecto.');
    }
    return assignment;
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new BadRequestException('El usuario indicado no existe.');
    }
  }

  private async injectCurrentKpi<T extends { id: string; kpis: unknown }>(project: T) {
    if (!project) return project;
    const completedTasksSum = await this.prisma.task.aggregate({
      where: {
        projectId: project.id,
        status: TaskStatus.COMPLETADO,
      },
      _sum: {
        actualPoints: true,
      },
    });
    const current = completedTasksSum._sum.actualPoints || 0;

    const existingKpis =
      typeof project.kpis === 'object' && project.kpis !== null
        ? (project.kpis as Record<string, unknown>)
        : {};

    return {
      ...project,
      kpis: {
        ...existingKpis,
        current,
      },
    };
  }
}
