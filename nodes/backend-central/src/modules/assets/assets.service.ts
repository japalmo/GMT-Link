import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssetStatus, AssetType, AssetIdentifierType, DocumentStatus, Prisma, ScopeType, AssetAccessory, ChecklistTemplate, ChecklistSubmission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { PermissionService } from '../../authz/permission.service';
import { ORG_ID } from '../../common/org.constant';
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
  Paginated,
} from './assets.types';

/** Estados no operativos: un activo en cualquiera de ellos no puede tomarse en uso. */
const NON_OPERATIONAL_STATUSES: AssetStatus[] = [
  AssetStatus.MANTENIMIENTO,
  AssetStatus.BAJA,
  AssetStatus.DEFECTUOSO,
  AssetStatus.NO_DISPONIBLE,
];

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    private readonly storage: StorageService,
    private readonly gamification: GamificationService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * ¿Puede el usuario VER la ficha (y sub-recursos de lectura) de este activo?
   *
   * Regla funcional (ADR-0001): quien tenga `asset:read` con scope GLOBAL ve
   * todo; con scope de proyectos, ve los de sus proyectos y los globales. Si no
   * tiene el permiso funcional, se conserva el gate estructural por-activo de
   * OpenFGA (usuario asignado / con `can_view_list` del proyecto) para no
   * romper la retrocompatibilidad. No concede ninguna escritura.
   */
  private async canViewAsset(
    userId: string,
    asset: { id: string; projectId: string | null },
  ): Promise<boolean> {
    const filter = await this.permissions.scopeFilter(userId, 'asset:read');
    if (filter) {
      if (filter.kind === 'none') return true; // GLOBAL => ve todo
      if (filter.kind === 'projects') {
        if (asset.projectId === null) return true; // globales visibles (paridad con hoy)
        if (filter.ids.includes(asset.projectId)) return true;
      }
    }
    // Fallback estructural: usuario asignado / con can_view del proyecto ve su
    // ficha aunque no tenga asset:read (retrocompatibilidad con el gate por-activo).
    return this.fga.check({
      user: `user:${userId}`,
      relation: 'can_view_list',
      object: `asset:${asset.id}`,
    });
  }

  /**
   * ¿Puede el usuario EJECUTAR el checklist/telemetría de este activo? Permite el
   * permiso funcional GLOBAL `asset:checklist:run:any` (admin/gerencia, cualquier
   * activo) O el gate estructural del usuario asignado (`can_run_checklist` en FGA).
   */
  private async canRunChecklist(userId: string, assetId: string): Promise<boolean> {
    const decision = await this.permissions.can(userId, 'asset:checklist:run:any');
    if (decision.effect === 'allow') return true;
    return this.fga.check({
      user: `user:${userId}`,
      relation: 'can_run_checklist',
      object: `asset:${assetId}`,
    });
  }

  /**
   * Exige que el usuario pueda GESTIONAR el activo (p.ej. cambiar su estado): FGA
   * `can_manage_assets` sobre su proyecto, o `admin` de la organización si el activo
   * es global. Reservado a acciones de gestión (NO a lecturas ni a tomar en uso).
   */
  private async assertCanManageAsset(
    userId: string,
    asset: { projectId: string | null },
  ): Promise<void> {
    const ok = asset.projectId
      ? await this.fga.check({
          user: `user:${userId}`,
          relation: 'can_manage_assets',
          object: `project:${asset.projectId}`,
        })
      : await this.fga.check({
          user: `user:${userId}`,
          relation: 'admin',
          object: `organization:${ORG_ID}`,
        });
    if (!ok) {
      throw new ForbiddenException('No tienes permiso para gestionar este activo.');
    }
  }

  /**
   * Proyectos "asociados" al usuario vía membresías directas (PROJECT) y por
   * expansión de departamento (DEPARTMENT). Usado como filtro de respaldo en
   * las listas cuando el usuario no tiene `asset:read` funcional.
   */
  private async allowedProjectIdsForUser(userId: string): Promise<string[]> {
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

    return projects.map((p) => p.id);
  }

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
      publicToken: row.publicToken,
      type: row.type,
      name: row.name,
      description: row.description,
      manufacturer: row.manufacturer,
      identifier: row.identifier,
      identifierType: row.identifierType,
      vehicleSubtype: row.vehicleSubtype,
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
    const prefix = (
      {
        [AssetType.EQUIPO]: 'GMT-EQ',
        [AssetType.VEHICULO]: 'GMT-VH',
        [AssetType.MAQUINARIA]: 'GMT-MQ',
      } as Record<AssetType, string>
    )[type];

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
    // Unicidad a nivel de aplicación (paridad con el MVP que tenía @unique):
    // si viene un identificador (patente / número de serie), no permitir duplicados
    // sobre la misma combinación (identifierType, identifier).
    if (dto.identifier) {
      const existing = await this.prisma.asset.findFirst({
        where: {
          identifier: dto.identifier,
          identifierType: dto.identifierType ?? null,
        },
      });
      if (existing) {
        throw new ConflictException(
          dto.identifierType === AssetIdentifierType.PATENTE
            ? 'Ya existe un activo con esa patente.'
            : 'Ya existe un activo con ese número de serie.',
        );
      }
    }

    const code = await this.generateAssetCode(dto.type);

    const assetId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          code,
          type: dto.type,
          name: dto.name,
          description: dto.description ?? null,
          manufacturer: dto.manufacturer ?? null,
          identifier: dto.identifier ?? null,
          identifierType: dto.identifierType ?? null,
          vehicleSubtype: dto.vehicleSubtype ?? null,
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
      const typeLabel = (
        {
          [AssetType.EQUIPO]: 'Equipo',
          [AssetType.VEHICULO]: 'Vehículo',
          [AssetType.MAQUINARIA]: 'Maquinaria',
        } as Record<AssetType, string>
      )[dto.type];
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
   * Lista los activos visibles por el usuario con paginación KEYSET estable.
   *
   * El orden es `code asc` (único), por lo que el cursor de la página siguiente
   * es el `code` del último item de la página previa: se piden los siguientes con
   * `code > cursor`. Se trae `limit + 1` filas para saber si hay más páginas sin
   * un `count` adicional; la fila centinela sobrante se descarta y su ausencia
   * marca el fin (nextCursor = null). `limit` default 30, máximo 100.
   *
   * `search` (opcional) filtra server-side por código / nombre / descripción
   * (case-insensitive). La lógica de scope (`asset:read` GLOBAL / projects, con
   * respaldo por membresías) se combina con los filtros en el mismo `where`.
   */
  async listAll(
    userId: string,
    opts: {
      type?: AssetType;
      status?: AssetStatus;
      projectId?: string;
      limit?: number;
      cursor?: string;
      search?: string;
    } = {},
  ): Promise<Paginated<AssetView>> {
    const { type, status, projectId, cursor, search } = opts;

    // Normaliza el límite: default 30, tope 100, mínimo 1. Ignora valores no
    // numéricos (p. ej. un `?limit=` mal formado que llega como NaN).
    const requestedLimit = opts.limit;
    const limit =
      requestedLimit !== undefined && Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 30;

    // Decisión funcional única (ADR-0001): quien tenga `asset:read` GLOBAL ve
    // TODO; con scope de proyectos, ve los suyos + globales; sin el permiso, se
    // cae al filtro estructural por membresías (retrocompatibilidad).
    const filter = await this.permissions.scopeFilter(userId, 'asset:read');

    // `undefined` = sin restricción de proyecto (GLOBAL). Un arreglo restringe
    // a esos proyectos (+ los globales sin proyecto).
    let allowedProjectIds: string[] | undefined;
    if (!filter || filter.kind === 'own') {
      allowedProjectIds = await this.allowedProjectIdsForUser(userId);
    } else if (filter.kind === 'projects') {
      allowedProjectIds = filter.ids;
    }
    // filter.kind === 'none' => allowedProjectIds queda undefined => ve todo.

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

    // Búsqueda server-side. Va en `AND` para no pisar el `OR` del scope de
    // proyectos (ambos deben cumplirse a la vez).
    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      where.AND = {
        OR: [
          { code: { contains: trimmedSearch, mode: 'insensitive' } },
          { name: { contains: trimmedSearch, mode: 'insensitive' } },
          { description: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      };
    }

    // Keyset sobre el orden `code asc` (único): la página siguiente es todo lo
    // que venga después del cursor.
    if (cursor) {
      where.code = { gt: cursor };
    }

    // limit + 1: la fila extra solo sirve para saber si hay página siguiente.
    const rows = await this.prisma.asset.findMany({
      where,
      include: {
        project: true,
        assignedTo: true,
        inUseBy: true,
      },
      orderBy: { code: 'asc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? lastRow.code : null;

    return {
      items: pageRows.map((r) => this.toAssetView(r)),
      nextCursor,
    };
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

    // Decisión funcional (asset:read) con respaldo estructural por-activo.
    if (!(await this.canViewAsset(userId, asset))) {
      throw new NotFoundException('El activo no existe o no tienes acceso.');
    }

    return this.toAssetView(asset);
  }

  /**
   * Ficha pública por TOKEN OPACO no enumerable (sin autenticación). El código
   * correlativo ya NO sirve para esta ruta: evita el raspado del parque (GAP3).
   */
  async getPublicByToken(token: string): Promise<AssetPublicView> {
    const asset = await this.prisma.asset.findUnique({
      where: { publicToken: token },
      include: {
        project: true,
      },
    });

    if (!asset) {
      throw new NotFoundException('Ficha técnica no encontrada.');
    }

    // GAP 3: la ficha pública (sin autenticación) no debe filtrar datos personales
    // ni el identificador. Solo expone información no sensible del activo.
    return {
      code: asset.code,
      type: asset.type,
      name: asset.name,
      description: asset.description,
      manufacturer: asset.manufacturer,
      vehicleSubtype: asset.vehicleSubtype,
      status: asset.status,
      project: asset.project ? { name: asset.project.name } : null,
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
    // Cambiar el estado es una acción de GESTIÓN (puede dar de baja el activo y
    // expulsar a quien lo tenga en uso): exige can_manage_assets, no basta con poder
    // ver el activo (hallazgo de auditoría: escalada desde permiso de solo lectura).
    await this.assertCanManageAsset(userId, asset);

    // Si transiciona a un estado no operativo y estaba en uso, liberarlo primero.
    const needsRelease = NON_OPERATIONAL_STATUSES.includes(dto.status) && asset.inUseById;

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

    if (NON_OPERATIONAL_STATUSES.includes(asset.status)) {
      throw new BadRequestException('El activo no está disponible para su uso.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Toma ATÓMICA: la condición inUseById:null va en el mismo UPDATE para que dos
      // tomas concurrentes no ganen ambas (TOCTOU en la "disputa en uso").
      const claimed = await tx.asset.updateMany({
        where: { id, inUseById: null },
        data: {
          inUseById: userId,
          inUseSince: new Date(),
          status: AssetStatus.EN_USO,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('El activo ya está en uso por otro colaborador.');
      }

      const actor = await tx.user.findUnique({ where: { id: userId } });
      const actorName = actor ? `${actor.firstName} ${actor.lastName}` : userId;

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
   * Carga la referencia mínima del activo (id + projectId) y valida que el
   * usuario pueda VERLO. Lanza 404 si no existe o no tiene acceso. Compartido
   * por los sub-recursos de lectura para no dejarlos sin autorización tras
   * remover el guard `can_view_list` del controller.
   */
  private async assertCanViewAsset(id: string, userId: string): Promise<void> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!asset || !(await this.canViewAsset(userId, asset))) {
      throw new NotFoundException('El activo no existe o no tienes acceso.');
    }
  }

  /**
   * Obtiene la lista de documentos de un activo.
   */
  async listDocuments(id: string, userId: string): Promise<AssetDocumentView[]> {
    await this.assertCanViewAsset(id, userId);
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
  async getHistory(id: string, userId: string): Promise<AssetHistoryEntryView[]> {
    await this.assertCanViewAsset(id, userId);
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

  async listAccessories(assetId: string, userId: string): Promise<AssetAccessoryView[]> {
    await this.assertCanViewAsset(assetId, userId);
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

  async getChecklistTemplate(assetId: string, userId: string): Promise<ChecklistTemplateView> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }
    if (!(await this.canViewAsset(userId, asset))) {
      throw new NotFoundException('El activo no existe o no tienes acceso.');
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
    if (!(await this.canRunChecklist(userId, assetId))) {
      throw new ForbiddenException('No tienes permiso para ejecutar el checklist de este activo.');
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

    // Mapa itemId → tipo de la plantilla. Solo las preguntas SÍ/NO cuentan como
    // falla; un campo de texto libre (p. ej. "Observaciones") cuyo texto sea "no"
    // NO debe forzar el paso a MANTENIMIENTO ni un registro de falla.
    const itemTypeById = new Map<string, string>();
    for (const raw of (template.items as unknown as Array<Record<string, unknown>>) ?? []) {
      if (raw && typeof raw.id === 'string' && typeof raw.type === 'string') {
        itemTypeById.set(raw.id, raw.type);
      }
    }
    let hasFailure = false;
    let failureDetail = '';
    for (const ans of answers) {
      const itemId = typeof ans.itemId === 'string' ? ans.itemId : '';
      const isYesNo = itemTypeById.get(itemId) === 'YES_NO';
      // Un booleano `false` solo puede provenir de una pregunta SÍ/NO. Un string
      // 'no'/'failed' solo cuenta como falla si el ítem es SÍ/NO (evita que un
      // campo de texto libre con el texto "no" fuerce MANTENIMIENTO).
      const negative =
        ans.value === false ||
        ((ans.value === 'no' || ans.value === 'failed') && isYesNo);
      if (negative) {
        hasFailure = true;
        failureDetail = String(ans.label || ans.itemId || 'ítem sin nombre');
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

  async listChecklistSubmissions(assetId: string, userId: string): Promise<ChecklistSubmissionView[]> {
    await this.assertCanViewAsset(assetId, userId);
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
  async generateChecklistSubmissionPdf(assetId: string, submissionId: string, userId: string): Promise<Uint8Array> {
    await this.assertCanViewAsset(assetId, userId);
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
    if (!(await this.canRunChecklist(userId, id))) {
      throw new ForbiddenException('No tienes permiso para registrar telemetría de este activo.');
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
