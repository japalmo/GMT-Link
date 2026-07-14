import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ScopeType, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import {
  CreateAssignmentDto,
  CreateProjectDto,
  CreateServiceDto,
  UpdateAssignmentDto,
  UpdateProjectDto,
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
    // La faena es OBLIGATORIA: de su `code` deriva el código autogenerado del
    // proyecto y su cliente debe coincidir con el del proyecto.
    const faena = await this.prisma.faena.findUnique({ where: { id: dto.faenaId } });
    if (!faena) {
      throw new BadRequestException('La faena indicada no existe.');
    }
    if (faena.clientId !== dto.clientId) {
      throw new BadRequestException('La faena no pertenece al cliente del proyecto.');
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

    // Código autogenerado `${faena.code}-${n}` con `n` correlativo por faena.
    // Se ignora cualquier `code` del input. `@@unique([faenaId, code])` cubre
    // la concurrencia.
    const code = await this.nextProjectCode(dto.faenaId, faena.code);

    const created = this.prisma.$transaction(async (tx) => {
      // 1. Crear el proyecto
      const project = await tx.project.create({
        data: {
          code,
          name: dto.name,
          description: dto.description ?? null,
          clientId: dto.clientId,
          contractNumber: dto.contractNumber ?? null,
          projectType: dto.projectType ?? null,
          faenaId: dto.faenaId,
          projectAdminId: dto.projectAdminId ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
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

      // 4. Escribir relaciones estructurales en OpenFGA. La tupla de
      //    departamento solo se escribe si el proyecto tiene departamento
      //    (ya no se asigna en la creación; queda por si alguna fila lo tuviera).
      const tuples = [
        {
          user: `client:${project.clientId}`,
          relation: 'client',
          object: `project:${project.id}`,
        },
      ];
      if (project.departmentId) {
        tuples.unshift({
          user: `department:${project.departmentId}`,
          relation: 'department',
          object: `project:${project.id}`,
        });
      }
      await this.fga.writeTuples(tuples);

      return this.injectCurrentKpi(project);
    });

    try {
      return await created;
    } catch (error) {
      // `@@unique([faenaId, code])`: dos creaciones simultáneas en la misma faena
      // pueden calcular el mismo `n`. El segundo insert choca (P2002) → 409.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'No se pudo asignar el código del proyecto por una creación simultánea. Intenta nuevamente.',
        );
      }
      throw error;
    }
  }

  /**
   * Próximo código de proyecto dentro de una faena: `${faenaCode}-${n}`. Toma
   * los proyectos de la faena cuyo `code` empieza con `${faenaCode}-`, parsea el
   * sufijo numérico tras el último `-`, toma el máximo y suma 1. Sin proyectos → 1.
   */
  private async nextProjectCode(faenaId: string, faenaCode: string): Promise<string> {
    const prefix = `${faenaCode}-`;
    const projects = await this.prisma.project.findMany({
      where: { faenaId },
      select: { code: true },
    });

    let maxN = 0;
    for (const { code } of projects) {
      if (!code.startsWith(prefix)) continue;
      const suffix = code.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      const n = Number.parseInt(suffix, 10);
      if (n > maxN) maxN = n;
    }

    return `${faenaCode}-${maxN + 1}`;
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
      return this.injectCurrentKpiBatch(projects);
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
    return this.injectCurrentKpiBatch(projects);
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
        // Incluye el tipo de servicio (Tanda 4) para mostrar tipo + procedimientos.
        services: { include: { serviceType: true } },
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
   * Crea un servicio dentro del proyecto ELIGIENDO UN TIPO del catálogo (Tanda 4).
   * El código corto (§7) se deriva del código del tipo (único por proyecto: prueba
   * sufijos numéricos ante colisión) y `docCodingConfig` toma el default de firma de
   * cliente del tipo. El nombre por defecto es el del tipo (o el que pase el usuario).
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

    const serviceType = await this.prisma.serviceType.findUnique({
      where: { id: dto.serviceTypeId },
    });
    if (!serviceType) {
      throw new BadRequestException('El tipo de servicio no existe.');
    }
    if (!serviceType.isActive) {
      throw new BadRequestException('El tipo de servicio está desactivado.');
    }

    const name = dto.name?.trim() || serviceType.name;
    const code = await this.deriveServiceCode(projectId, serviceType.code);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const service = await tx.service.create({
          data: {
            code,
            name,
            projectId,
            serviceTypeId: serviceType.id,
            frequency: dto.frequency ?? null,
            docCodingConfig: { requiresClientSignature: serviceType.requiresClientSignature },
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
    } catch (error) {
      // Carrera: dos creaciones simultáneas del mismo tipo derivan el mismo código
      // (deriveServiceCode escanea fuera de la transacción) y chocan con
      // @@unique([projectId, code]). El índice protege la integridad; devolvemos un
      // 409 amigable en vez de un 500 genérico.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'No se pudo asignar el código del servicio por una creación simultánea. Vuelve a intentarlo.',
        );
      }
      throw error;
    }
  }

  /**
   * Deriva un código de servicio único DENTRO del proyecto a partir del código del
   * tipo. Si el código base ya está tomado, prueba `BASE2`, `BASE3`, … El código es
   * un segmento del código de documento (§7); se conserva estable en el servicio (no
   * se recalcula si luego cambia el tipo).
   */
  private async deriveServiceCode(projectId: string, typeCode: string): Promise<string> {
    const base = typeCode.toUpperCase();
    const rows = await this.prisma.service.findMany({
      where: { projectId },
      select: { code: true },
    });
    const taken = new Set(rows.map((r) => r.code));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base}${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    // Improbable: 1000 servicios del mismo tipo en un proyecto.
    return `${base}${taken.size + 1}`;
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
   * Actualización GENERAL del proyecto (solo `name`/`description` en este corte).
   * NO toca la faena ni las claves estructurales (clientId/code/FGA). El gate de
   * `project:update` lo pone el controller.
   */
  async updateGeneral(projectId: string, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) {
      throw new NotFoundException('El proyecto no existe.');
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name,
        description: dto.description,
      },
    });
    return this.injectCurrentKpi(updated);
  }

  /**
   * Elimina un proyecto. Solo procede si está "limpio": sin servicios, tareas,
   * documentos, elementos, trabajadores asignados ni activos. Si tiene contenido,
   * responde 409 con el detalle de lo que bloquea. La membresía `project_creator`
   * autocreada NO cuenta como bloqueante (se limpia junto al proyecto).
   * Al borrar: sincroniza la baja en OpenFGA (membresías de proyecto + tuplas
   * estructurales de cliente/departamento), borra las membresías de scope PROJECT
   * y el proyecto en una sola transacción. El gate de `project:delete` lo pone el
   * controller.
   */
  async remove(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        _count: {
          select: { services: true, tasks: true, documents: true, elements: true, workers: true, overtimeRequests: true },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }

    // Los activos tienen `projectId` opcional (onDelete: SetNull), así que no
    // vienen en el _count por relación: se cuentan aparte.
    const assetCount = await this.prisma.asset.count({ where: { projectId } });

    const blockers: string[] = [];
    if (project._count.services > 0) blockers.push(`${project._count.services} servicio(s)`);
    if (project._count.tasks > 0) blockers.push(`${project._count.tasks} tarea(s)`);
    if (project._count.documents > 0) blockers.push(`${project._count.documents} documento(s)`);
    if (project._count.elements > 0) blockers.push(`${project._count.elements} elemento(s)`);
    if (project._count.workers > 0)
      blockers.push(`${project._count.workers} trabajador(es) asignado(s)`);
    if (project._count.overtimeRequests > 0)
      blockers.push(`${project._count.overtimeRequests} solicitud(es) de horas extra`);
    if (assetCount > 0) blockers.push(`${assetCount} activo(s)`);

    if (blockers.length > 0) {
      throw new ConflictException(
        `No puedes eliminar el proyecto: tiene ${blockers.join(', ')}.`,
      );
    }

    // Membresías de scope PROJECT del proyecto (incluye la autocreada
    // `project_creator`): se sincroniza su baja en FGA y se borran en la misma
    // transacción. Los errores de FGA no deben abortar el borrado local.
    const memberships = await this.prisma.membership.findMany({
      where: { scopeType: ScopeType.PROJECT, scopeId: projectId },
    });

    // Tuplas estructurales escritas al crear (cliente + departamento si lo hubiera).
    const structuralTuples = [
      { user: `client:${project.clientId}`, relation: 'client', object: `project:${projectId}` },
    ];
    if (project.departmentId) {
      structuralTuples.push({
        user: `department:${project.departmentId}`,
        relation: 'department',
        object: `project:${projectId}`,
      });
    }

    // Solo Postgres dentro de la transacción. Si entre el conteo y el delete se
    // agregó un hijo con FK Restrict (p.ej. un servicio), Postgres lanza P2003:
    // se mapea al mismo 409 que clientes/faenas (carrera TOCTOU).
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.membership.deleteMany({ where: { scopeType: ScopeType.PROJECT, scopeId: projectId } });
        await tx.project.delete({ where: { id: projectId } });
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(
          'No puedes eliminar el proyecto: se le agregó contenido mientras se eliminaba. Vuelve a intentarlo.',
        );
      }
      throw error;
    }

    // La sincronización de la baja en FGA va DESPUÉS del commit (OpenFGA no es
    // transaccional ni idempotente): si el borrado local falla, FGA no se toca.
    // Los fallos se registran, no abortan (el proyecto ya no existe en Postgres).
    for (const membership of memberships) {
      await this.fga
        .syncMembershipToFGA(
          {
            userId: membership.userId,
            roleKey: membership.roleKey,
            scopeType: ScopeType.PROJECT,
            scopeId: projectId,
          },
          'delete',
        )
        .catch((error: unknown) =>
          this.logger.error(
            `No se pudo sincronizar la baja FGA de la membresía del proyecto ${projectId} (usuario ${membership.userId}).`,
            error instanceof Error ? error.stack : String(error),
          ),
        );
    }
    await this.fga
      .deleteTuples(structuralTuples)
      .catch((error: unknown) =>
        this.logger.error(
          `No se pudieron borrar las tuplas estructurales FGA del proyecto ${projectId}.`,
          error instanceof Error ? error.stack : String(error),
        ),
      );

    return { success: true };
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

    return this.withCurrentKpi(project, current);
  }

  /**
   * Igual que `injectCurrentKpi` pero para una LISTA: calcula el KPI `current` de
   * todos los proyectos con UNA sola agregación por lotes (`groupBy` por proyecto)
   * en vez de un `task.aggregate` por proyecto (evita el N+1 del listado). La forma
   * de salida es idéntica: cada proyecto con `kpis.current` inyectado.
   */
  private async injectCurrentKpiBatch<T extends { id: string; kpis: unknown }>(projects: T[]) {
    if (projects.length === 0) return [];
    const sums = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: {
        status: TaskStatus.COMPLETADO,
        projectId: { in: projects.map((p) => p.id) },
      },
      _sum: { actualPoints: true },
    });
    const byProject = new Map(sums.map((s) => [s.projectId, s._sum.actualPoints ?? 0]));
    return projects.map((project) => this.withCurrentKpi(project, byProject.get(project.id) ?? 0));
  }

  /** Inyecta `kpis.current` conservando el resto de KPIs configurados (JSONB). */
  private withCurrentKpi<T extends { kpis: unknown }>(project: T, current: number) {
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
