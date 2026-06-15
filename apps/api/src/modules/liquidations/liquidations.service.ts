import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import type { CreateLiquidationDto } from './dto/liquidations.dto';

const LIQUIDATIONS_FOLDER = 'liquidations';

const USER_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

export interface UploadedLiquidationFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class LiquidationsService {
  private readonly logger = new Logger(LiquidationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Crea/Sube una nueva liquidación de sueldo para un colaborador (sólo gestor). */
  async create(
    uploadedById: string,
    dto: CreateLiquidationDto,
    file: UploadedLiquidationFile,
  ) {
    // Verificar que el usuario destino exista
    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!targetUser) {
      throw new BadRequestException('El usuario destino no existe.');
    }

    // Verificar si ya existe una liquidación para ese usuario en ese periodo
    const existing = await this.prisma.liquidation.findUnique({
      where: {
        userId_period: {
          userId: dto.userId,
          period: dto.period,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe una liquidación para el periodo ${dto.period} y este usuario.`,
      );
    }

    // Guardar archivo en el Storage
    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: LIQUIDATIONS_FOLDER,
    });

    // Crear en base de datos
    return this.prisma.liquidation.create({
      data: {
        userId: dto.userId,
        period: dto.period,
        fileUrl: saved.url,
        uploadedById,
      },
      include: {
        user: USER_SELECT,
      },
    });
  }

  /** Lista las liquidaciones del usuario autenticado (ordenadas por periodo desc). */
  async listMine(userId: string) {
    return this.prisma.liquidation.findMany({
      where: { userId },
      orderBy: { period: 'desc' },
    });
  }

  /** Lista todas las liquidaciones (vista de gestor). */
  async listAll() {
    return this.prisma.liquidation.findMany({
      include: {
        user: USER_SELECT,
      },
      orderBy: [
        { period: 'desc' },
        { user: { lastName: 'asc' } },
      ],
    });
  }

  /** Borra una liquidación (sólo gestor) y su archivo en el storage (best-effort). */
  async remove(id: string): Promise<void> {
    const liquidation = await this.prisma.liquidation.findUnique({
      where: { id },
    });
    if (!liquidation) {
      throw new NotFoundException('La liquidación no existe.');
    }

    // Borrar de base de datos
    await this.prisma.liquidation.delete({
      where: { id },
    });

    // Borrar de storage (best-effort)
    await this.bestEffortDelete(liquidation.fileUrl);
  }

  private async bestEffortDelete(fileUrl: string | null): Promise<void> {
    if (!fileUrl) return;
    const key = extractStorageKey(fileUrl);
    if (!key) return;
    try {
      await this.storage.delete(key);
    } catch (error: unknown) {
      this.logger.warn(`No se pudo borrar el archivo "${key}" del storage: ${String(error)}`);
    }
  }
}

function extractStorageKey(fileUrl: string): string | null {
  const marker = '/files/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  const key = fileUrl.slice(idx + marker.length);
  return key.length > 0 ? decodeURIComponent(key) : null;
}
