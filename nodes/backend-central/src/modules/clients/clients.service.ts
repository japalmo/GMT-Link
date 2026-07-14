import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FaenaStatus, Prisma, TaskStatus } from '@prisma/client';
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
   * Elimina un cliente. Bloquea el borrado si tiene faenas o proyectos
   * asociados: el cliente es la raíz de la jerarquía Cliente→Faena→Proyecto
   * (§7) y arrastrar esos registros dejaría huérfanos códigos y documentos.
   * El count previo da el mensaje con las cantidades, pero es TOCTOU; el cierre
   * real es la FK (Faena/Project.clientId → Client.id): si la carrera ocurre,
   * el delete revienta con P2003 y se mapea al mismo 409.
   */
  async remove(id: string) {
    await this.getById(id);

    const [faenasCount, projectsCount, usersCount] = await Promise.all([
      this.prisma.faena.count({ where: { clientId: id } }),
      this.prisma.project.count({ where: { clientId: id } }),
      this.prisma.user.count({ where: { clientId: id } }),
    ]);

    // Faena/Project.clientId son FK Restrict (la BD respalda el bloqueo), pero
    // User.clientId es SetNull: sin este conteo, borrar un cliente con usuarios
    // asociados los dejaría huérfanos (clientId=null) en silencio.
    if (faenasCount > 0 || projectsCount > 0 || usersCount > 0) {
      throw new ConflictException(
        `No puedes eliminar el cliente: tiene ${faenasCount} faena(s), ${projectsCount} proyecto(s) y ${usersCount} usuario(s) asociados. Elimina o reasigna esos registros primero.`,
      );
    }

    try {
      await this.prisma.client.delete({ where: { id } });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(
          'No puedes eliminar el cliente: tiene faenas o proyectos asociados. Elimina o reasigna esos registros primero.',
        );
      }
      throw error;
    }

    return { success: true };
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
