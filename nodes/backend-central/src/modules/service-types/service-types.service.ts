import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ServiceType } from '@prisma/client';
import type { Procedimiento, ServiceTypeView } from '@gmt-platform/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateServiceTypeDto, ProcedimientoDto, UpdateServiceTypeDto } from './dto/service-type.dto';

/** ServiceType con el conteo de servicios que lo usan (para bloquear el borrado). */
type ServiceTypeWithCount = ServiceType & { _count: { services: number } };

const WITH_COUNT = { _count: { select: { services: true } } } as const;

/**
 * Catálogo org-level de tipos de servicio (Tanda 4). CRUD directo: el control de
 * acceso (`service_type:manage`) lo aplica el controller. Cada tipo aporta el código
 * corto que semilla la codificación de documentos (§7), el default de firma de
 * cliente y su lista de procedimientos (pasos con instrucciones). El código y el
 * nombre son únicos en toda la organización (choque -> 409).
 */
@Injectable()
export class ServiceTypesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista los tipos. `includeInactive` incluye los desactivados (catálogo admin). */
  async list(includeInactive: boolean): Promise<ServiceTypeView[]> {
    const rows = await this.prisma.serviceType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: WITH_COUNT,
    });
    return rows.map((row) => this.toView(row));
  }

  async create(dto: CreateServiceTypeDto): Promise<ServiceTypeView> {
    try {
      const row = await this.prisma.serviceType.create({
        data: {
          code: dto.code.toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          requiresClientSignature: dto.requiresClientSignature ?? false,
          procedures: this.normalizeProcedures(dto.procedures),
        },
        include: WITH_COUNT,
      });
      return this.toView(row);
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  async update(id: string, dto: UpdateServiceTypeDto): Promise<ServiceTypeView> {
    await this.assertExists(id);
    const data: Prisma.ServiceTypeUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code.toUpperCase();
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.requiresClientSignature !== undefined) data.requiresClientSignature = dto.requiresClientSignature;
    if (dto.procedures !== undefined) data.procedures = this.normalizeProcedures(dto.procedures);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const row = await this.prisma.serviceType.update({ where: { id }, data, include: WITH_COUNT });
      return this.toView(row);
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  /** Borra un tipo. 409 si algún servicio lo usa (se recomienda desactivar en su lugar). */
  async remove(id: string): Promise<void> {
    const row = await this.prisma.serviceType.findUnique({ where: { id }, include: WITH_COUNT });
    if (!row) {
      throw new NotFoundException('No existe un tipo de servicio con ese id.');
    }
    if (row._count.services > 0) {
      throw new ConflictException(
        'No puedes borrar un tipo de servicio que ya está en uso. Desactívalo en su lugar.',
      );
    }
    await this.prisma.serviceType.delete({ where: { id } });
  }

  /** 404 si el tipo no existe (chequeo liviano). */
  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.serviceType.findUnique({ where: { id }, select: { id: true } });
    if (!found) {
      throw new NotFoundException('No existe un tipo de servicio con ese id.');
    }
  }

  /** Recorta y normaliza los procedimientos a la forma persistida (array JSON). */
  private normalizeProcedures(procs?: ProcedimientoDto[]): Prisma.InputJsonValue {
    if (!procs) return [];
    return procs.map((p) => ({
      id: p.id,
      nombre: p.nombre.trim(),
      instrucciones: p.instrucciones?.trim() || null,
    }));
  }

  private toView(row: ServiceTypeWithCount): ServiceTypeView {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      requiresClientSignature: row.requiresClientSignature,
      procedures: Array.isArray(row.procedures) ? (row.procedures as unknown as Procedimiento[]) : [],
      isActive: row.isActive,
      serviceCount: row._count.services,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Traduce el choque de unicidad (P2002) de code/name a un 409 legible. */
  private rethrowUnique(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]).join(',') : '';
      if (target.includes('code')) {
        throw new ConflictException('Ya existe un tipo de servicio con ese código.');
      }
      if (target.includes('name')) {
        throw new ConflictException('Ya existe un tipo de servicio con ese nombre.');
      }
      throw new ConflictException('Ya existe un tipo de servicio con esos datos.');
    }
    throw err;
  }
}
