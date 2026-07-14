import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectDocumentStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFaenaDto, UpdateFaenaDto } from './dto/faenas.dto';

@Injectable()
export class FaenasService {
  private readonly logger = new Logger(FaenasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una faena para un cliente. El `code` se AUTOGENERA como
   * `${client.code}-${letra}` donde `letra` es la siguiente correlativa (A, B,
   * … Z, AA, AB…) según las faenas existentes del cliente. Se ignora cualquier
   * `code` que venga en el input. `@@unique([clientId, code])` queda como red de
   * seguridad ante concurrencia. supervisor/estado/fechas NO se fijan al crear
   * (status toma su default PLANIFICADA del schema).
   */
  async create(clientId: string, dto: CreateFaenaDto) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException('El cliente no existe.');
    }

    const code = await this.nextFaenaCode(clientId, client.code);

    try {
      return await this.prisma.faena.create({
        data: {
          clientId,
          code,
          name: dto.name,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          address: dto.address ?? null,
        },
      });
    } catch (error) {
      // `@@unique([clientId, code])`: dos creaciones simultáneas pueden calcular
      // la misma letra. El segundo insert choca (P2002) → 409 para reintentar.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'No se pudo asignar el código de la faena por una creación simultánea. Intenta nuevamente.',
        );
      }
      throw error;
    }
  }

  /**
   * Calcula el próximo código de faena para un cliente: `${clientCode}-${letra}`.
   * Toma las faenas existentes del cliente cuyo `code` empieza con el prefijo
   * `${clientCode}-`, parsea el sufijo alfabético tras el último `-`, lo convierte
   * a índice (A=1, …, Z=26, AA=27…), toma el máximo y suma 1. Sin faenas → 'A'.
   */
  private async nextFaenaCode(clientId: string, clientCode: string): Promise<string> {
    const prefix = `${clientCode}-`;
    const faenas = await this.prisma.faena.findMany({
      where: { clientId },
      select: { code: true },
    });

    let maxIndex = 0;
    for (const { code } of faenas) {
      if (!code.startsWith(prefix)) continue;
      const index = lettersToIndex(code.slice(prefix.length).toUpperCase());
      if (index > maxIndex) maxIndex = index;
    }

    return `${clientCode}-${indexToLetters(maxIndex + 1)}`;
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
    return { ...rest, projects, ...metrics };
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

  /**
   * Elimina una faena. Se bloquea con 409 si la faena tiene proyectos
   * asociados: primero hay que eliminar o reasignar esos proyectos.
   */
  async remove(id: string) {
    const faena = await this.prisma.faena.findUnique({ where: { id } });
    if (!faena) {
      throw new NotFoundException('La faena no existe.');
    }

    const projectsCount = await this.prisma.project.count({ where: { faenaId: id } });
    if (projectsCount > 0) {
      throw new ConflictException({
        code: 'FAENA_HAS_PROJECTS',
        message: `No puedes eliminar la faena "${faena.code}" porque tiene ${projectsCount} proyecto(s) asociado(s). Elimina o reasigna los proyectos primero.`,
      });
    }

    try {
      await this.prisma.faena.delete({ where: { id } });
    } catch (error) {
      // Red de seguridad ante concurrencia: un proyecto creado entre el conteo
      // y el delete dispara una violación de FK (P2003) → mismo 409.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException({
          code: 'FAENA_HAS_PROJECTS',
          message: `No puedes eliminar la faena "${faena.code}" porque tiene proyecto(s) asociado(s). Elimina o reasigna los proyectos primero.`,
        });
      }
      throw error;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async withMetrics<T extends { projects: { id: string }[] }>(faena: T) {
    const { projects, ...rest } = faena;
    const metrics = await this.computeMetrics(projects.map((p) => p.id));
    return { ...rest, ...metrics };
  }

  /** Calcula métricas agregadas sobre un conjunto de proyectos. */
  private async computeMetrics(projectIds: string[]) {
    if (projectIds.length === 0) {
      return { projectsCount: 0, activeProjectsCount: 0, pendingAlertsCount: 0 };
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
      pendingAlertsCount: alertsCount,
    };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new BadRequestException('El supervisor indicado no existe.');
    }
  }
}

/**
 * Sufijo alfabético (bijective base-26) → índice: 'A'→1, 'Z'→26, 'AA'→27…
 * Devuelve 0 si el sufijo no es puramente alfabético (se ignora en el máximo).
 */
export function lettersToIndex(letters: string): number {
  if (letters.length === 0 || !/^[A-Z]+$/.test(letters)) return 0;
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64); // 'A'(65) → 1
  }
  return index;
}

/** Índice (≥1) → sufijo alfabético: 1→'A', 26→'Z', 27→'AA'… (inversa de lettersToIndex). */
export function indexToLetters(index: number): string {
  let letters = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
