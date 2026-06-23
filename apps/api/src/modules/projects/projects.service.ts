import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ScopeType, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { CreateProjectDto, CreateServiceDto, UpdateProjectKpisDto } from './dto/projects.dto';

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

    return this.prisma.$transaction(async (tx) => {
      // 1. Crear el proyecto
      const project = await tx.project.create({
        data: {
          code: dto.code.toUpperCase(),
          name: dto.name,
          departmentId: dto.departmentId,
          clientId: dto.clientId,
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
  async listAll(userId: string) {
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

    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { id: { in: projectIds } },
          { departmentId: { in: departmentIds } },
        ],
      },
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
