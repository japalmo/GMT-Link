import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProjectDocumentStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFaenaDto, UpdateFaenaDto } from './dto/faenas.dto';

@Injectable()
export class FaenasService {
  private readonly logger = new Logger(FaenasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una faena para un cliente. `code` es único dentro del cliente
   * (@@unique([clientId, code]) en el schema).
   */
  async create(clientId: string, dto: CreateFaenaDto) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException('El cliente no existe.');
    }

    const code = dto.code.toUpperCase();
    const existing = await this.prisma.faena.findFirst({ where: { clientId, code } });
    if (existing) {
      throw new BadRequestException(`Ya existe una faena con el código "${dto.code}" en este cliente.`);
    }

    if (dto.supervisorId) {
      await this.assertUserExists(dto.supervisorId);
    }

    return this.prisma.faena.create({
      data: {
        clientId,
        code,
        name: dto.name,
        supervisorId: dto.supervisorId ?? null,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });
  }

  /**
   * Lista las faenas de un cliente con métricas agregadas por faena:
   *  - projectsCount: nº total de proyectos en la faena.
   *  - activeProjectsCount: proyectos con al menos una tarea no COMPLETADA.
   *  - alertsCount: documentos de proyecto RECHAZADO dentro de la faena.
   */
  async listByClient(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException('El cliente no existe.');
    }

    const faenas = await this.prisma.faena.findMany({
      where: { clientId },
      include: {
        supervisor: { select: { id: true, firstName: true, lastName: true, email: true } },
        projects: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(faenas.map((faena) => this.withMetrics(faena)));
  }

  /** Detalle de una faena con sus proyectos y métricas. */
  async getById(id: string) {
    const faena = await this.prisma.faena.findUnique({
      where: { id },
      include: {
        client: true,
        supervisor: { select: { id: true, firstName: true, lastName: true, email: true } },
        projects: {
          include: {
            department: true,
            projectAdmin: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!faena) {
      throw new NotFoundException('La faena no existe.');
    }
    const { projects, ...rest } = faena;
    const metrics = await this.computeMetrics(projects.map((p) => p.id));
    return { ...rest, projects, metrics };
  }

  /** Actualiza campos editables de una faena. */
  async update(id: string, dto: UpdateFaenaDto) {
    const faena = await this.prisma.faena.findUnique({ where: { id } });
    if (!faena) {
      throw new NotFoundException('La faena no existe.');
    }
    if (dto.supervisorId) {
      await this.assertUserExists(dto.supervisorId);
    }
    return this.prisma.faena.update({
      where: { id },
      data: {
        name: dto.name,
        supervisorId: dto.supervisorId,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async withMetrics<T extends { projects: { id: string }[] }>(faena: T) {
    const { projects, ...rest } = faena;
    const metrics = await this.computeMetrics(projects.map((p) => p.id));
    return { ...rest, metrics };
  }

  /** Calcula métricas agregadas sobre un conjunto de proyectos. */
  private async computeMetrics(projectIds: string[]) {
    if (projectIds.length === 0) {
      return { projectsCount: 0, activeProjectsCount: 0, alertsCount: 0 };
    }

    const [activeProjects, alertsCount] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, status: { not: TaskStatus.COMPLETADO } },
      }),
      this.prisma.projectDocument.count({
        where: { projectId: { in: projectIds }, status: ProjectDocumentStatus.RECHAZADO },
      }),
    ]);

    return {
      projectsCount: projectIds.length,
      activeProjectsCount: activeProjects.length,
      alertsCount,
    };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new BadRequestException('El supervisor indicado no existe.');
    }
  }
}
