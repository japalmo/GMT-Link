import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FaenaStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientView } from './clients.types';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea un cliente. El `code` (≤4 chars) es único a nivel organización y se
   * normaliza a mayúsculas (parte de la codificación de documentos, §7).
   */
  async create(dto: CreateClientDto) {
    const code = dto.code.toUpperCase();

    const existing = await this.prisma.client.findUnique({ where: { code } });
    if (existing) {
      throw new BadRequestException(`Ya existe un cliente con el código "${code}".`);
    }

    return this.prisma.client.create({
      data: {
        code,
        name: dto.name,
        rut: dto.rut ?? null,
      },
    });
  }

  /**
   * Lista los clientes con sus métricas agregadas (ClientView[]).
   * Calcula por cliente: total de proyectos, proyectos activos y tareas
   * PENDIENTE en sus proyectos.
   */
  async listAll(): Promise<ClientView[]> {
    const clients = await this.prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: {
        projects: {
          select: {
            id: true,
            faena: { select: { status: true, endDate: true } },
          },
        },
      },
    });

    if (clients.length === 0) return [];

    // Tareas PENDIENTE agrupadas por proyecto, en un solo query.
    const projectIds = clients.flatMap((c) => c.projects.map((p) => p.id));
    const pendingByProject = projectIds.length
      ? await this.prisma.task.groupBy({
          by: ['projectId'],
          where: { projectId: { in: projectIds }, status: TaskStatus.PENDIENTE },
          _count: { _all: true },
        })
      : [];

    const pendingCountMap = new Map<string, number>(
      pendingByProject.map((row) => [row.projectId, row._count._all]),
    );

    return clients.map((client) => this.toView(client, pendingCountMap));
  }

  /**
   * Detalle de un cliente por ID (sin métricas).
   */
  async getById(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) {
      throw new NotFoundException('El cliente no existe.');
    }
    return client;
  }

  /**
   * Actualiza los campos editables de un cliente (name, rut). El `code` es inmutable.
   */
  async update(id: string, dto: UpdateClientDto) {
    await this.getById(id);

    return this.prisma.client.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        rut: dto.rut ?? undefined,
      },
    });
  }

  /**
   * Determina si un proyecto está "activo": sin faena, o con faena que no está
   * COMPLETADA y no tiene fecha de fin.
   */
  private isProjectActive(project: {
    faena: { status: FaenaStatus; endDate: Date | null } | null;
  }): boolean {
    if (!project.faena) return true;
    return project.faena.status !== FaenaStatus.COMPLETADA && project.faena.endDate === null;
  }

  private toView(
    client: {
      id: string;
      code: string;
      name: string;
      rut: string | null;
      projects: { id: string; faena: { status: FaenaStatus; endDate: Date | null } | null }[];
    },
    pendingCountMap: Map<string, number>,
  ): ClientView {
    const projectsCount = client.projects.length;
    const activeProjectsCount = client.projects.filter((p) => this.isProjectActive(p)).length;
    const pendingAlertsCount = client.projects.reduce(
      (sum, p) => sum + (pendingCountMap.get(p.id) ?? 0),
      0,
    );

    return {
      id: client.id,
      code: client.code,
      name: client.name,
      rut: client.rut,
      projectsCount,
      activeProjectsCount,
      pendingAlertsCount,
    };
  }
}
