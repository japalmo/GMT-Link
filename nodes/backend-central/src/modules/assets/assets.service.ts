import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssetStatus, AssetType, DocumentStatus, Prisma, ScopeType, AssetAccessory, ChecklistTemplate, ChecklistSubmission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { StorageService } from '../../common/storage/storage.service';
import { GamificationService } from '../gamification/gamification.service';
import { CreateAssetDto, UpdateAssetStatusDto, SubmitTelemetryDto } from './dto/assets.dto';
import { composeChecklistPdf } from './checklist-pdf.util';
import {
  AssetDocumentView,
  AssetHistoryEntryView,
  AssetPublicView,
  AssetView,
  AssetAccessoryView,
  ChecklistTemplateView,
  ChecklistSubmissionView,
} from './assets.types';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    private readonly storage: StorageService,
    private readonly gamification: GamificationService,
  ) {}

  /**
   * Mapea un registro de Asset de base de datos a la vista del frontend.
   */
  private toAssetView(row: Prisma.AssetGetPayload<{
    include: {
      project: true;
      assignedTo: true;
      inUseBy: true;
    };
  }>): AssetView {
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      name: row.name,
      description: row.description,
      status: row.status,
      projectId: row.projectId,
      assignedToId: row.assignedToId,
      inUseById: row.inUseById,
      inUseSince: row.inUseSince ? row.inUseSince.toISOString() : null,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      project: row.project ? { id: row.project.id, name: row.project.name } : null,
      assignedTo: row.assignedTo
        ? { id: row.assignedTo.id, firstName: row.assignedTo.firstName, lastName: row.assignedTo.lastName }
        : null,
      inUseBy: row.inUseBy
        ? { id: row.inUseBy.id, firstName: row.inUseBy.firstName, lastName: row.inUseBy.lastName }
        : null,
    };
  }

  /**
   * Mapea un registro de documento de activo a su vista.
   */
  private toDocView(row: Prisma.AssetDocumentGetPayload<{
    include: {
      reviewedBy: true;
    };
  }>): AssetDocumentView {
    return {
      id: row.id,
      assetId: row.assetId,
      name: row.name,
      type: row.type,
      fileUrl: row.fileUrl,
      status: row.status,
      previousFileUrl: row.previousFileUrl,
      reviewedById: row.reviewedById,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      expirationDate: row.expirationDate ? row.expirationDate.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reviewedBy: row.reviewedBy
        ? { firstName: row.reviewedBy.firstName, lastName: row.reviewedBy.lastName }
        : null,
    };
  }

  /**
   * Mapea un registro del historial a su vista.
   */
  private toHistoryView(row: Prisma.AssetHistoryEntryGetPayload<{
    include: {
      actor: true;
    };
  }>): AssetHistoryEntryView {
    return {
      id: row.id,
      assetId: row.assetId,
      type: row.type,
      description: row.description,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor
        ? { firstName: row.actor.firstName, lastName: row.actor.lastName }
        : null,
    };
  }

  /**
   * Genera el código único del activo en formato secuencial e incremental:
   * GMT-EQ-XXXX (Equipos) o GMT-VH-XXXX (Vehículos).
   */
  private async generateAssetCode(type: AssetType): Promise<string> {
    const prefix = type === AssetType.EQUIPO ? 'GMT-EQ' : 'GMT-VH';

    // Contar los activos existentes del mismo tipo
    const count = await this.prisma.asset.count({
      where: { type },
    });

    let serial = count + 1;
    let code = `${prefix}-${String(serial).padStart(4, '0')}`;

    // Validar unicidad por si hay huecos en la secuencia
    let exists = await this.prisma.asset.findUnique({ where: { code } });
    while (exists) {
      serial += 1;
      code = `${prefix}-${String(serial).padStart(4, '0')}`;
      exists = await this.prisma.asset.findUnique({ where: { code } });
    }

    return code;
  }

  /**
   * Registra una entrada en el historial de trazabilidad del activo.
   */
  private async createHistoryEntry(
    tx: Prisma.TransactionClient,
    assetId: string,
    type: string,
    description: string,
    actorId?: string,
  ): Promise<void> {
    await tx.assetHistoryEntry.create({
      data: {
        assetId,
        type,
        description,
        actorId: actorId ?? null,
      },
    });
  }

  /**
   * Crea un nuevo activo con código auto-generado, sincroniza FGA y registra historial.
   */
  async create(userId: string, dto: CreateAssetDto): Promise<AssetView> {
    const code = await this.generateAssetCode(dto.type);

    const assetId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          code,
          type: dto.type,
          name: dto.name,
          description: dto.description ?? null,
          status: AssetStatus.DISPONIBLE,
          projectId: dto.projectId ?? null,
          assignedToId: dto.assignedToId ?? null,
          metadata: dto.metadata ? (dto.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      // Crear tuplas estructurales en OpenFGA
      const writes: { user: string; relation: string; object: string }[] = [];
      
      if (created.projectId) {
        writes.push({
          user: `project:${created.projectId}`,
          relation: 'project',
          object: `asset:${created.id}`,
        });
      }

      if (created.assignedToId) {
        writes.push({
          user: `user:${created.assignedToId}`,
          relation: 'assigned',
          object: `asset:${created.id}`,
        });
      }

      if (writes.length > 0) {
        await this.fga.writeTuples(writes);
      }

      // Registrar historial
      const typeLabel = dto.type === AssetType.EQUIPO ? 'Equipo' : 'Vehículo';
      await this.createHistoryEntry(
        tx,
        created.id,
        'CREADO',
        `${typeLabel} registrado con código ${code}.`,
        userId,
      );

      if (created.assignedToId) {
        const assignedUser = await tx.user.findUnique({ where: { id: created.assignedToId } });
        const nameStr = assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName}` : created.assignedToId;
        await this.createHistoryEntry(
          tx,
          created.id,
          'ASIGNADO',
          `Asignado inicialmente a ${nameStr} como responsable.`,
          userId,
        );
      }

      return created.id;
    });

    const row = await this.prisma.asset.findUniqueOrThrow({
      where: { id: assetId },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    return this.toAssetView(row);
  }

  /**
   * Lista todos los activos visibles por el usuario.
   */
  async listAll(userId: string, type?: AssetType, status?: AssetStatus, projectId?: string): Promise<AssetView[]> {
    // Si es administrador global de la organización, puede ver todos los activos.
    const isGlobalAdmin = await this.prisma.membership.findFirst({
      where: {
        userId,
        roleKey: 'org_admin',
        scopeType: ScopeType.ORGANIZATION,
      },
    });

    let allowedProjectIds: string[] | undefined;

    if (!isGlobalAdmin) {
      // Obtener proyectos accesibles para el usuario
      const memberships = await this.prisma.membership.findMany({
        where: {
          userId,
          scopeType: { in: [ScopeType.PROJECT, ScopeType.DEPARTMENT] },
        },
      });

      const userProjectIds = memberships
        .filter((m) => m.scopeType === ScopeType.PROJECT)
        .map((m) => m.scopeId);

      const departmentIds = memberships
        .filter((m) => m.scopeType === ScopeType.DEPARTMENT)
        .map((m) => m.scopeId);

      const projects = await this.prisma.project.findMany({
        where: {
          OR: [
            { id: { in: userProjectIds } },
            { departmentId: { in: departmentIds } },
          ],
        },
        select: { id: true },
      });

      allowedProjectIds = projects.map((p) => p.id);
    }

    const where: Prisma.AssetWhereInput = {};

    if (allowedProjectIds) {
      where.OR = [
        { projectId: { in: allowedProjectIds } },
        { projectId: null }, // Activos globales/no asignados a un proyecto son visibles
      ];
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (projectId) {
      if (allowedProjectIds && !allowedProjectIds.includes(projectId)) {
        throw new BadRequestException('No tienes acceso a los activos de este proyecto.');
      }
      where.projectId = projectId;
    }

    const rows = await this.prisma.asset.findMany({
      where,
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
      orderBy: { code: 'asc' },
    });

    return rows.map((r) => this.toAssetView(r));
  }

  /**
   * Obtiene el detalle de un activo específico.
   */
  async getById(id: string, userId: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    // Verificar permiso can_view_list en OpenFGA
    const allowed = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_view_list',
      object: `asset:${id}`,
    });

    if (!allowed) {
      throw new NotFoundException('El activo no existe o no tienes acceso.');
    }

    return this.toAssetView(asset);
  }

  /**
   * Ficha pública: consulta rápida por código correlativo (sin autenticación).
   */
  async getPublicByCode(code: string): Promise<AssetPublicView> {
    const asset = await this.prisma.asset.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    if (!asset) {
      throw new NotFoundException('Ficha técnica no encontrada.');
    }

    return {
      code: asset.code,
      type: asset.type,
      name: asset.name,
      description: asset.description,
      status: asset.status,
      project: asset.project ? { name: asset.project.name } : null,
      assignedTo: asset.assignedTo
        ? { firstName: asset.assignedTo.firstName, lastName: asset.assignedTo.lastName }
        : null,
      inUseBy: asset.inUseBy
        ? { firstName: asset.inUseBy.firstName, lastName: asset.inUseBy.lastName }
        : null,
    };
  }

  /**
   * Actualiza el estado de un activo (DISPONIBLE, MANTENIMIENTO, BAJA, etc.) y registra historial.
   */
  async updateStatus(id: string, userId: string, dto: UpdateAssetStatusDto): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    // Si transiciona a un estado no operativo (MANTENIMIENTO/BAJA/DEFECTUOSO/NO_DISPONIBLE)
    // y estaba en uso, liberarlo primero.
    const nonOperationalStatuses: AssetStatus[] = [
      AssetStatus.MANTENIMIENTO,
      AssetStatus.BAJA,
      AssetStatus.DEFECTUOSO,
      AssetStatus.NO_DISPONIBLE,
    ];
    const needsRelease = nonOperationalStatuses.includes(dto.status) && asset.inUseById;

    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          status: dto.status,
          ...(needsRelease ? { inUseById: null, inUseSince: null } : {}),
        },
      });

      const reasonDesc = dto.description ? ` Motivo: ${dto.description}` : '';
      await this.createHistoryEntry(
        tx,
        id,
        'ESTADO',
        `Estado cambiado de ${asset.status} a ${dto.status}.${reasonDesc}`,
        userId,
      );

      if (needsRelease) {
        await this.createHistoryEntry(
          tx,
          id,
          'LIBERADO',
          `Liberado automáticamente al entrar en estado ${dto.status}.`,
          userId,
        );
      }
    });

    const row = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    return this.toAssetView(row);
  }

  /**
   * Asigna un responsable al activo, actualizando OpenFGA.
   */
  async assign(id: string, userId: string, assignedToId: string | null): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.asset.update({
        where: { id },
        data: {
          assignedToId,
        },
        include: {
          assignedTo: true,
        },
      });

      // Sincronizar tuplas en FGA
      if (asset.assignedToId) {
        await this.fga.deleteTuples([
          { user: `user:${asset.assignedToId}`, relation: 'assigned', object: `asset:${id}` },
        ]);
      }

      if (assignedToId) {
        await this.fga.writeTuples([
          { user: `user:${assignedToId}`, relation: 'assigned', object: `asset:${id}` },
        ]);
      }

      const actorName = row.assignedTo
        ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}`
        : 'nadie';

      await this.createHistoryEntry(
        tx,
        id,
        'ASIGNADO',
        `Asignado a ${actorName} como responsable.`,
        userId,
      );
    });

    const row = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    return this.toAssetView(row);
  }

  /**
   * Disputa "en uso": toma un activo para utilizarlo.
   */
  async takeUse(id: string, userId: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    if (asset.status === AssetStatus.MANTENIMIENTO || asset.status === AssetStatus.BAJA) {
      throw new BadRequestException('El activo no está disponible para su uso (en mantenimiento o baja).');
    }

    if (asset.inUseById) {
      throw new ConflictException(`El activo ya está en uso por otro colaborador.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.asset.update({
        where: { id },
        data: {
          inUseById: userId,
          inUseSince: new Date(),
          status: AssetStatus.EN_USO,
        },
        include: {
          inUseBy: true,
        },
      });

      const userActor = row.inUseBy;
      const actorName = userActor ? `${userActor.firstName} ${userActor.lastName}` : userId;

      await this.createHistoryEntry(
        tx,
        id,
        'EN_USO',
        `Activo tomado en uso por ${actorName}.`,
        userId,
      );
    });

    const row = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    return this.toAssetView(row);
  }

  /**
   * Disputa "en uso": libera el activo.
   */
  async releaseUse(id: string, userId: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    if (!asset.inUseById) {
      throw new BadRequestException('El activo no se encuentra en uso actualmente.');
    }

    // Permitir liberar si es el usuario en uso o el administrador global.
    const isGlobalAdmin = await this.prisma.membership.findFirst({
      where: {
        userId,
        roleKey: 'org_admin',
        scopeType: ScopeType.ORGANIZATION,
      },
    });

    if (asset.inUseById !== userId && !isGlobalAdmin) {
      throw new BadRequestException('No puedes liberar un activo tomado por otro colaborador.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          inUseById: null,
          inUseSince: null,
          status: AssetStatus.DISPONIBLE,
        },
      });

      await this.createHistoryEntry(
        tx,
        id,
        'LIBERADO',
        `Activo liberado y marcado como disponible.`,
        userId,
      );
    });

    const row = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    return this.toAssetView(row);
  }

  /**
   * Sube un documento asociado al activo.
   */
  async uploadDocument(
    id: string,
    userId: string,
    name: string,
    type: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    expirationDate?: string,
  ): Promise<AssetDocumentView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    // Subir archivo a R2 local
    const folder = `assets/${id}/documents`;
    const saved = await this.storage.save({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder,
    });

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assetDocument.create({
        data: {
          assetId: id,
          name,
          type,
          fileUrl: saved.url,
          status: DocumentStatus.EN_REVISION,
          expirationDate: expirationDate ? new Date(expirationDate) : null,
        },
        include: {
          reviewedBy: true,
        },
      });

      await this.createHistoryEntry(
        tx,
        id,
        'DOC',
        `Subido documento "${name}" de tipo "${type}" para revisión.`,
        userId,
      );

      return created;
    });

    return this.toDocView(doc);
  }

  /**
   * Aprueba o rechaza el documento de un activo (ApprovalWorkflow).
   */
  async reviewDocument(
    id: string,
    docId: string,
    userId: string,
    status: DocumentStatus,
    reason?: string,
  ): Promise<AssetDocumentView> {
    const doc = await this.prisma.assetDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.assetId !== id) {
      throw new NotFoundException('El documento no existe para este activo.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.assetDocument.update({
        where: { id: docId },
        data: {
          status,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
        include: {
          reviewedBy: true,
        },
      });

      const statusDesc = status === DocumentStatus.APROBADO ? 'Aprobado' : 'Rechazado';
      const reasonDesc = reason ? ` Motivo: ${reason}` : '';
      await this.createHistoryEntry(
        tx,
        id,
        'DOC',
        `Documento "${doc.name}" marcado como ${statusDesc}.${reasonDesc}`,
        userId,
      );

      return row;
    });

    return this.toDocView(updated);
  }

  /**
   * Obtiene la lista de documentos de un activo.
   */
  async listDocuments(id: string): Promise<AssetDocumentView[]> {
    const rows = await this.prisma.assetDocument.findMany({
      where: { assetId: id },
      include: { reviewedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDocView(r));
  }

  /**
   * Obtiene la línea de tiempo de eventos históricos de un activo.
   */
  async getHistory(id: string): Promise<AssetHistoryEntryView[]> {
    const rows = await this.prisma.assetHistoryEntry.findMany({
      where: { assetId: id },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toHistoryView(r));
  }

  // ==========================================
  // ACCESORIOS CRUD (Etapa 5.2)
  // ==========================================

  private toAccessoryView(row: AssetAccessory): AssetAccessoryView {
    return {
      id: row.id,
      assetId: row.assetId,
      name: row.name,
      description: row.description,
      serialNumber: row.serialNumber,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listAccessories(assetId: string): Promise<AssetAccessoryView[]> {
    const rows = await this.prisma.assetAccessory.findMany({
      where: { assetId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toAccessoryView(r));
  }

  async addAccessory(
    assetId: string,
    userId: string,
    dto: { name: string; description?: string; serialNumber?: string },
  ): Promise<AssetAccessoryView> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.assetAccessory.create({
        data: {
          assetId,
          name: dto.name,
          description: dto.description ?? null,
          serialNumber: dto.serialNumber ?? null,
        },
      });

      await this.createHistoryEntry(
        tx,
        assetId,
        'OTRO',
        `Accesorio "${dto.name}" agregado.`,
        userId,
      );

      return row;
    });

    return this.toAccessoryView(created);
  }

  async updateAccessory(
    assetId: string,
    accId: string,
    userId: string,
    dto: { name?: string; description?: string; serialNumber?: string },
  ): Promise<AssetAccessoryView> {
    const acc = await this.prisma.assetAccessory.findUnique({ where: { id: accId } });
    if (!acc || acc.assetId !== assetId) {
      throw new NotFoundException('El accesorio no existe para este activo.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.assetAccessory.update({
        where: { id: accId },
        data: {
          name: dto.name,
          description: dto.description !== undefined ? dto.description : undefined,
          serialNumber: dto.serialNumber !== undefined ? dto.serialNumber : undefined,
        },
      });

      await this.createHistoryEntry(
        tx,
        assetId,
        'OTRO',
        `Accesorio "${acc.name}" actualizado.`,
        userId,
      );

      return row;
    });

    return this.toAccessoryView(updated);
  }

  async removeAccessory(assetId: string, accId: string, userId: string): Promise<void> {
    const acc = await this.prisma.assetAccessory.findUnique({ where: { id: accId } });
    if (!acc || acc.assetId !== assetId) {
      throw new NotFoundException('El accesorio no existe para este activo.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.assetAccessory.delete({ where: { id: accId } });
      await this.createHistoryEntry(
        tx,
        assetId,
        'OTRO',
        `Accesorio "${acc.name}" eliminado.`,
        userId,
      );
    });
  }

  // ==========================================
  // CHECKLIST TEMPLATE (ApprovalWorkflow §5)
  // ==========================================

  private toTemplateView(
    row: ChecklistTemplate & { reviewedBy?: { firstName: string; lastName: string } | null },
  ): ChecklistTemplateView {
    return {
      id: row.id,
      assetId: row.assetId,
      name: row.name,
      items: row.items as unknown as Record<string, unknown>[],
      status: row.status,
      previousItems: row.previousItems ? (row.previousItems as unknown as Record<string, unknown>[]) : null,
      reviewedById: row.reviewedById,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reviewedBy: row.reviewedBy
        ? { firstName: row.reviewedBy.firstName, lastName: row.reviewedBy.lastName }
        : null,
    };
  }

  private loadDefaultVehicleChecklist(): Record<string, unknown>[] {
    try {
      const pathsToTry = [
        path.resolve(process.cwd(), '../../docs/checklist_camioneta.csv'),
        path.resolve(process.cwd(), './docs/checklist_camioneta.csv'),
        path.resolve(__dirname, '../../../../../docs/checklist_camioneta.csv'),
      ];
      
      let csvPath = '';
      for (const p of pathsToTry) {
        if (fs.existsSync(p)) {
          csvPath = p;
          break;
        }
      }
      
      if (!csvPath) {
        this.logger.warn(`Checklist CSV not found in search paths, returning empty items`);
        return [];
      }
      
      const content = fs.readFileSync(csvPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
      // Skip header: id,label,type,required
      const items: Record<string, unknown>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const parts = line.split(',');
        const id = parts[0];
        const label = parts[1];
        const type = parts[2];
        const requiredStr = parts[3];
        if (id && label && type && requiredStr) {
          items.push({
            id: id.trim(),
            label: label.trim(),
            type: type.trim(),
            required: requiredStr.trim().toLowerCase() === 'true',
          });
        }
      }
      return items;
    } catch (error) {
      this.logger.error('Error reading checklist_camioneta.csv', error);
      return [];
    }
  }

  async getChecklistTemplate(assetId: string): Promise<ChecklistTemplateView> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    let template = await this.prisma.checklistTemplate.findUnique({
      where: { assetId },
      include: { reviewedBy: true },
    });

    if (!template) {
      const defaultItems = asset.type === AssetType.VEHICULO ? this.loadDefaultVehicleChecklist() : [];
      template = await this.prisma.checklistTemplate.create({
        data: {
          assetId,
          name: `Checklist de ${asset.name}`,
          items: defaultItems as unknown as Prisma.InputJsonValue,
          status: DocumentStatus.APROBADO,
        },
        include: { reviewedBy: true },
      });
    }

    return this.toTemplateView(template);
  }

  async updateChecklistTemplate(
    assetId: string,
    userId: string,
    name: string,
    items: Record<string, unknown>[],
  ): Promise<ChecklistTemplateView> {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { assetId } });
    if (!template) {
      throw new NotFoundException('La plantilla de checklist no existe.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.checklistTemplate.update({
        where: { assetId },
        data: {
          name,
          items: items as unknown as Prisma.InputJsonValue,
          previousItems: template.items as Prisma.InputJsonValue,
          status: DocumentStatus.EN_REVISION,
          reviewedById: null,
          reviewedAt: null,
          rejectionReason: null,
        },
        include: { reviewedBy: true },
      });

      await this.createHistoryEntry(
        tx,
        assetId,
        'OTRO',
        `Nueva revisión de plantilla de checklist guardada (pendiente de aprobación).`,
        userId,
      );

      return row;
    });

    return this.toTemplateView(updated);
  }

  async reviewChecklistTemplate(
    assetId: string,
    userId: string,
    status: DocumentStatus,
    reason?: string,
  ): Promise<ChecklistTemplateView> {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { assetId } });
    if (!template) {
      throw new NotFoundException('La plantilla de checklist no existe.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.checklistTemplate.update({
        where: { assetId },
        data: {
          status,
          reviewedById: userId,
          reviewedAt: new Date(),
          rejectionReason: status === DocumentStatus.RECHAZADO ? reason ?? null : null,
        },
        include: { reviewedBy: true },
      });

      const statusText = status === DocumentStatus.APROBADO ? 'aprobada' : 'rechazada';
      const reasonText = reason ? ` Motivo: ${reason}` : '';
      await this.createHistoryEntry(
        tx,
        assetId,
        'OTRO',
        `Plantilla de checklist marcada como ${statusText}.${reasonText}`,
        userId,
      );

      return row;
    });

    return this.toTemplateView(updated);
  }

  // ==========================================
  // CHECKLIST SUBMISSIONS
  // ==========================================

  private toSubmissionView(
    row: ChecklistSubmission & { user?: { firstName: string; lastName: string } | null },
  ): ChecklistSubmissionView {
    return {
      id: row.id,
      assetId: row.assetId,
      templateId: row.templateId,
      userId: row.userId,
      answers: row.answers as unknown as Record<string, unknown>[],
      createdAt: row.createdAt.toISOString(),
      user: row.user
        ? { firstName: row.user.firstName, lastName: row.user.lastName }
        : null,
    };
  }

  async submitChecklist(
    assetId: string,
    templateId: string,
    userId: string,
    answers: Record<string, unknown>[],
  ): Promise<ChecklistSubmissionView> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    const template = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.assetId !== assetId) {
      throw new NotFoundException('La plantilla no corresponde a este activo.');
    }
    if (template.status !== DocumentStatus.APROBADO) {
      throw new BadRequestException('Solo se pueden enviar checklists basados en plantillas aprobadas.');
    }

    // Validar y actualizar odómetro si es un Vehículo y tiene la pregunta de kilometraje
    let updatedOdometerKm: number | null = null;
    if (asset.type === AssetType.VEHICULO) {
      const odometerAns = answers.find(ans => ans.itemId === 'kilometraje' || String(ans.label).toLowerCase().includes('kilometraje'));
      if (odometerAns && odometerAns.value !== undefined && odometerAns.value !== '') {
        const reportedKm = Number(odometerAns.value);
        if (isNaN(reportedKm)) {
          throw new BadRequestException('El valor de kilometraje reportado debe ser un número.');
        }
        
        const currentMeta = (asset.metadata as Record<string, unknown> | null) || {};
        const currentKm = Number(currentMeta.odometerKm ?? 0);
        if (reportedKm < currentKm) {
          throw new BadRequestException(`El kilometraje reportado (${reportedKm} km) no puede ser menor al kilometraje actual (${currentKm} km).`);
        }
        updatedOdometerKm = reportedKm;
      }
    }

    let hasFailure = false;
    let failureDetail = '';
    for (const ans of answers) {
      if (ans.value === false || ans.value === 'no' || ans.value === 'failed') {
        hasFailure = true;
        const itemLabel = ans.label || ans.itemId || 'ítem sin nombre';
        failureDetail = String(itemLabel);
        break;
      }
    }

    const submission = await this.prisma.$transaction(async (tx) => {
      const row = await tx.checklistSubmission.create({
        data: {
          assetId,
          templateId,
          userId,
          answers: answers as unknown as Prisma.InputJsonValue,
        },
        include: {
          user: true,
        },
      });

      if (updatedOdometerKm !== null) {
        const currentMeta = (asset.metadata as Record<string, unknown> | null) || {};
        const updatedMeta = {
          ...currentMeta,
          odometerKm: updatedOdometerKm,
        };
        await tx.asset.update({
          where: { id: assetId },
          data: {
            metadata: updatedMeta as Prisma.InputJsonValue,
          },
        });
        await this.createHistoryEntry(
          tx,
          assetId,
          'ESTADO',
          `Kilometraje (odómetro) actualizado automáticamente a ${updatedOdometerKm} km desde checklist.`,
          userId,
        );
      }

      const failureMsg = hasFailure ? ` con reporte de falla en "${failureDetail}"` : '';
      await this.createHistoryEntry(
        tx,
        assetId,
        'CHECKLIST',
        `Checklist ejecutado y enviado${failureMsg}.`,
        userId,
      );

      if (hasFailure) {
        await tx.asset.update({
          where: { id: assetId },
          data: { status: AssetStatus.MANTENIMIENTO },
        });

        await this.createHistoryEntry(
          tx,
          assetId,
          'ESTADO',
          `Estado cambiado automáticamente a MANTENIMIENTO debido a falla reportada en checklist.`,
          userId,
        );
      }

      return row;
    });

    this.awardChecklistPoints(userId);
    return this.toSubmissionView(submission);
  }

  // Gamificación hook — se llama después de submitChecklist exitoso
  private awardChecklistPoints(userId: string): void {
    void this.gamification.awardPoints(userId, 'RUN_CHECKLIST');
  }

  async listChecklistSubmissions(assetId: string): Promise<ChecklistSubmissionView[]> {
    const rows = await this.prisma.checklistSubmission.findMany({
      where: { assetId },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSubmissionView(r));
  }

  /**
   * Genera un PDF con la plantilla + respuestas de una ChecklistSubmission.
   * Devuelve los bytes (application/pdf). Lanza 404 si la submission no existe
   * o no pertenece al activo indicado.
   */
  async generateChecklistSubmissionPdf(assetId: string, submissionId: string): Promise<Uint8Array> {
    const submission = await this.prisma.checklistSubmission.findUnique({
      where: { id: submissionId },
      include: { user: true, template: true, asset: true },
    });
    if (!submission || submission.assetId !== assetId) {
      throw new NotFoundException('El checklist enviado no corresponde a este activo.');
    }

    const templateItems = (submission.template.items as unknown as Record<string, unknown>[]) ?? [];
    const answers = (submission.answers as unknown as Record<string, unknown>[]) ?? [];

    // Indexa respuestas por itemId para resolver el valor de cada ítem de la plantilla.
    const answerByItemId = new Map<string, Record<string, unknown>>();
    for (const ans of answers) {
      const key = ans.itemId ?? ans.id;
      if (key !== undefined && key !== null) {
        answerByItemId.set(String(key), ans);
      }
    }

    // Construye una fila por cada ítem de la plantilla (preserva orden y etiquetas).
    // Si la plantilla no tiene ítems, cae a las respuestas crudas.
    const source = templateItems.length > 0 ? templateItems : answers;
    const rows = source.map((item) => {
      const itemId = item.id ?? item.itemId;
      const ans = itemId !== undefined && itemId !== null ? answerByItemId.get(String(itemId)) : undefined;
      const effective = ans ?? item;
      const label = String(item.label ?? item.itemId ?? item.id ?? 'Ítem sin nombre');
      const comment = effective.comment !== undefined && effective.comment !== null && String(effective.comment) !== ''
        ? String(effective.comment)
        : undefined;
      return {
        label,
        valueLabel: this.formatChecklistValue(effective.value),
        comment,
      };
    });

    const submittedByName = submission.user
      ? `${submission.user.firstName} ${submission.user.lastName}`.trim()
      : 'Desconocido';

    return composeChecklistPdf({
      assetCode: submission.asset.code,
      assetName: submission.asset.name,
      templateName: submission.template.name,
      submittedBy: submittedByName,
      submittedAt: submission.createdAt.toISOString(),
      rows,
    });
  }

  /** Formatea el valor de una respuesta a una etiqueta legible para el PDF. */
  private formatChecklistValue(value: unknown): string {
    if (value === undefined || value === null || value === '') return '-';
    if (value === true || value === 'yes' || value === 'ok') return 'Sí';
    if (value === false || value === 'no' || value === 'failed') return 'No';
    return String(value);
  }

  async updateTelemetry(id: string, userId: string, dto: SubmitTelemetryDto): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    if (asset.type !== AssetType.VEHICULO) {
      throw new BadRequestException('Solo los vehículos soportan telemetría de ubicación y velocidad.');
    }

    const currentMeta = (asset.metadata as Record<string, unknown> | null) || {};
    const updatedMeta = {
      ...currentMeta,
      location: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        updatedAt: new Date().toISOString(),
      },
      speed: dto.speed,
    };

    const speedLimit = Number(currentMeta.speedLimit ?? 100);
    const triggerSpeedingAlert = dto.speed > speedLimit;

    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          metadata: updatedMeta as Prisma.InputJsonValue,
        },
      });

      if (triggerSpeedingAlert) {
        await this.createHistoryEntry(
          tx,
          id,
          'ESTADO',
          `Alerta: Exceso de velocidad detectado (${dto.speed} km/h, límite: ${speedLimit} km/h).`,
          userId,
        );
      }
    });

    const row = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
    });

    return this.toAssetView(row);
  }
}
