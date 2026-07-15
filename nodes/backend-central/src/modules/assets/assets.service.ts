import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';
import { AssetStatus, AssetType, AssetIdentifierType, DocumentStatus, Prisma, ScopeType, AssetAccessory, ChecklistTemplate, ChecklistSubmission, UsageCycleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { PermissionService } from '../../authz/permission.service';
import { ORG_ID } from '../../common/org.constant';
import { StorageService } from '../../common/storage/storage.service';
import { GamificationService } from '../gamification/gamification.service';
import type { TablePage, TableRequest, UsageCycleView, EndUsageCycleInput } from '@gmt-platform/contracts';
import { CreateAssetDto, UpdateAssetDto, UpdateAssetStatusDto, SubmitTelemetryDto } from './dto/assets.dto';
import { composeChecklistPdf } from './checklist-pdf.util';
import { tableOrderBy, tablePage, tableSkipTake } from '../../common/table-pagination.util';
import {
  AssetDocumentView,
  AssetHistoryEntryView,
  AssetPublicView,
  AssetView,
  AssetAccessoryView,
  ChecklistTemplateView,
  ChecklistSubmissionView,
  ChecklistTemplateItem,
  ChecklistAnswer,
  Paginated,
} from './assets.types';
import {
  DEFAULT_VEHICLE_CHECKLIST,
  isFailure,
  parseTemplateItems,
  submitAnswersSchema,
} from './checklist.schema';

/** Estados no operativos: un activo en cualquiera de ellos no puede tomarse en uso. */
const NON_OPERATIONAL_STATUSES: AssetStatus[] = [
  AssetStatus.MANTENIMIENTO,
  AssetStatus.BAJA,
  AssetStatus.DEFECTUOSO,
  AssetStatus.NO_DISPONIBLE,
];

/** Foto opcional (recogida/entrega) de un ciclo de uso, ya leída del multipart. */
export interface UsageCyclePhotoInput {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/** Respuesta de las mutaciones del ciclo de uso: el activo y el ciclo actualizados. */
export interface UsageCycleResult {
  asset: AssetView;
  cycle: UsageCycleView;
}

/** Estrecha un valor de filtro al enum AssetType; undefined si no pertenece (evita 500 de Prisma). */
function asAssetType(value: unknown): AssetType | undefined {
  return typeof value === 'string' && (Object.values(AssetType) as string[]).includes(value)
    ? (value as AssetType)
    : undefined;
}

/** Estrecha un valor de filtro al enum AssetStatus; undefined si no pertenece. */
function asAssetStatus(value: unknown): AssetStatus | undefined {
  return typeof value === 'string' && (Object.values(AssetStatus) as string[]).includes(value)
    ? (value as AssetStatus)
    : undefined;
}

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
   * tiene el permiso funcional, un activo GLOBAL (flota, `projectId` null) igual
   * es visible para quien pueda reportar uso o ejecutar checklist (rol conductor
   * / bundles admin); esto habilita el flujo tomar en uso -> llenar checklist del
   * vehículo. Como último respaldo se conserva el gate estructural por-activo de
   * OpenFGA (usuario asignado / con `can_view_list` del proyecto) para no romper la
   * retrocompatibilidad. Este detalle es a propósito MÁS estricto que el listado
   * (`buildScopedAssetWhere` muestra los globales a cualquier usuario con membresía,
   * incluidos los externos client_ito): el detalle sí excluye a los externos de los
   * globales, porque no tienen ninguno de esos permisos funcionales. Ver NO concede
   * escritura: tomar/liberar y ejecutar checklist/telemetría exigen además el permiso
   * correspondiente (ver assertCanReportUse / canRunChecklist).
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
    // Activo GLOBAL (flota) sin asset:read: lo ve quien puede reportar uso o
    // ejecutar checklist de cualquier activo (conductor / bundles admin). Los
    // externos (client_ito / viewer) no tienen estos permisos funcionales.
    if (asset.projectId === null) {
      const [report, checklist] = await Promise.all([
        this.permissions.can(userId, 'asset:use:report'),
        this.permissions.can(userId, 'asset:checklist:run:any'),
      ]);
      if (report.effect === 'allow' || checklist.effect === 'allow') return true;
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
   * Exige que el usuario pueda REPORTAR uso (tomar/liberar la disputa "en uso")
   * de este activo. Requiere DOS condiciones:
   *  1. el permiso funcional GLOBAL `asset:use:report` (rol conductor / bundles
   *     admin), y
   *  2. poder VER el activo (`canViewAsset`).
   * El permiso solo (sin ver) permitiría tomar activos ajenos que ni siquiera se
   * ven; la visibilidad sola (sin permiso) dejaría a externos (client_ito/viewer)
   * tomar activos de su proyecto. Ambos juntos acotan la acción a la flota y a los
   * activos que el usuario ya puede ver, y excluyen a los usuarios cliente. Así
   * `asset:read` vuelve a ser de solo lectura (no habilita tomar/liberar).
   */
  private async assertCanReportUse(
    userId: string,
    asset: { id: string; projectId: string | null },
  ): Promise<void> {
    const decision = await this.permissions.can(userId, 'asset:use:report');
    if (decision.effect !== 'allow') {
      throw new ForbiddenException('No tienes permiso para reportar uso de activos.');
    }
    if (!(await this.canViewAsset(userId, asset))) {
      throw new ForbiddenException('No tienes acceso a este activo.');
    }
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
    // Normaliza el límite: default 30, tope 100, mínimo 1. Ignora valores no
    // numéricos (p. ej. un `?limit=` mal formado que llega como NaN).
    const requestedLimit = opts.limit;
    const limit =
      requestedLimit !== undefined && Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 30;

    const where = await this.buildScopedAssetWhere(userId, opts);

    // Keyset sobre el orden `code asc` (único): la página siguiente es todo lo
    // que venga después del cursor.
    if (opts.cursor) {
      where.code = { gt: opts.cursor };
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
   * Lista activos con el MOTOR de tablas server-side (offset). Reusa el mismo
   * `where` (scope `asset:read` + filtros type/status/projectId + búsqueda) que el
   * keyset `listAll`, pero devuelve una página numerada + total, con orden
   * configurable. Columnas ordenables: código, nombre, estado, fabricante, creado
   * (default código asc). Los filtros llegan en `req.filters` (type/status/projectId),
   * validados contra sus enums para no reventar la consulta. Lo consume la tabla
   * del catálogo de recursos (una subsección por tipo inyecta `filters.type`).
   */
  async listAllTable(userId: string, req: TableRequest): Promise<TablePage<AssetView>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);
    const filters = req.filters ?? {};
    const projectId =
      typeof filters.projectId === 'string' && filters.projectId.trim()
        ? filters.projectId.trim()
        : undefined;

    const where = await this.buildScopedAssetWhere(userId, {
      type: asAssetType(filters.type),
      status: asAssetStatus(filters.status),
      projectId,
      search: req.search,
    });

    const orderBy = tableOrderBy<Prisma.AssetOrderByWithRelationInput[]>(
      req,
      {
        codigo: (dir) => [{ code: dir }],
        nombre: (dir) => [{ name: dir }, { code: 'asc' }],
        estado: (dir) => [{ status: dir }, { code: 'asc' }],
        fabricante: (dir) => [{ manufacturer: dir }, { code: 'asc' }],
        creado: (dir) => [{ createdAt: dir }, { code: 'asc' }],
      },
      [{ code: 'asc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        include: { project: true, assignedTo: true, inUseBy: true },
        orderBy,
        skip,
        take,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return tablePage(rows.map((r) => this.toAssetView(r)), total, page, pageSize);
  }

  /**
   * Arma el `where` de la lista de activos: scope funcional `asset:read` (ADR-0001,
   * GLOBAL / projects / respaldo por membresías) + filtros type/status/projectId +
   * búsqueda por código/nombre/descripción. Compartido por el keyset `listAll` y el
   * offset `listAllTable` para que ambos apliquen exactamente el mismo filtrado.
   */
  private async buildScopedAssetWhere(
    userId: string,
    opts: { type?: AssetType; status?: AssetStatus; projectId?: string; search?: string },
  ): Promise<Prisma.AssetWhereInput> {
    const { type, status, projectId, search } = opts;

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
    const trimmedSearch = typeof search === 'string' ? search.trim() : '';
    if (trimmedSearch) {
      where.AND = {
        OR: [
          { code: { contains: trimmedSearch, mode: 'insensitive' } },
          { name: { contains: trimmedSearch, mode: 'insensitive' } },
          { description: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      };
    }

    return where;
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
   * Edita los campos DESCRIPTIVOS de un activo (Tanda 5.2): nombre, descripción,
   * fabricante, identificador/tipo, subtipo de vehículo y metadata. Exige
   * `can_manage_assets` (mismo gate que las demás mutaciones de gestión). El tipo y
   * el proyecto NO se tocan aquí. Conserva la unicidad blanda del identificador
   * (excluyéndose a sí mismo) y registra una entrada de historial.
   */
  async update(id: string, userId: string, dto: UpdateAssetDto): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }
    await this.assertCanManageAsset(userId, asset);

    if (dto.vehicleSubtype != null && asset.type !== AssetType.VEHICULO) {
      throw new BadRequestException('El subtipo de vehículo solo aplica a activos de tipo VEHICULO.');
    }

    // Unicidad blanda del identificador (paridad con create), excluyéndose a sí mismo.
    const nextIdentifier =
      dto.identifier !== undefined ? dto.identifier?.trim() || null : asset.identifier;
    const nextIdentifierType =
      dto.identifierType !== undefined ? dto.identifierType : asset.identifierType;
    if (
      (dto.identifier !== undefined || dto.identifierType !== undefined) &&
      nextIdentifier
    ) {
      const clash = await this.prisma.asset.findFirst({
        where: {
          id: { not: id },
          identifier: nextIdentifier,
          identifierType: nextIdentifierType,
        },
      });
      if (clash) {
        throw new ConflictException(
          nextIdentifierType === AssetIdentifierType.PATENTE
            ? 'Ya existe un activo con esa patente.'
            : 'Ya existe un activo con ese número de serie.',
        );
      }
    }

    const data: Prisma.AssetUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.manufacturer !== undefined) data.manufacturer = dto.manufacturer?.trim() || null;
    if (dto.identifier !== undefined) data.identifier = dto.identifier?.trim() || null;
    if (dto.identifierType !== undefined) data.identifierType = dto.identifierType;
    if (dto.vehicleSubtype !== undefined) {
      // Un no-vehículo nunca guarda subtipo (defensa extra a la validación de arriba).
      data.vehicleSubtype = asset.type === AssetType.VEHICULO ? dto.vehicleSubtype : null;
    }
    if (dto.metadata !== undefined) {
      // MERGE, no reemplazo: preserva claves escritas por otras vías (telemetría,
      // checklist) que el editor descriptivo no toca. `null` limpia toda la metadata
      // con el guard `Prisma.JsonNull` (Prisma rechaza un null JS plano en Json?).
      data.metadata = dto.metadata
        ? ({ ...((asset.metadata as Record<string, unknown> | null) ?? {}), ...dto.metadata } as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data });
      await this.createHistoryEntry(tx, id, 'EDITADO', 'Información del activo editada.', userId);
    });

    const row = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: { project: true, assignedTo: true, inUseBy: true },
    });
    return this.toAssetView(row);
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
        // Documentos APROBADOS (Tanda 5.2): la ficha pública prueba que el activo
        // tiene su documentación al día. Se ordenan por vencimiento (los que vencen
        // antes primero) y solo se expone metadata (nombre/tipo/vencimiento), nunca
        // el archivo, para no filtrar documentos en una ruta sin autenticación.
        documents: {
          where: { status: DocumentStatus.APROBADO },
          orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        },
        // Última inspección (checklist ejecutado): solo nombre de plantilla + fecha.
        checklistSubmissions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { template: { select: { name: true } } },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('Ficha técnica no encontrada.');
    }

    const now = Date.now();
    const EXPIRING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const documents = asset.documents.map((d) => {
      const expiresMs = d.expirationDate ? d.expirationDate.getTime() : null;
      return {
        name: d.name,
        type: d.type,
        expiresAt: d.expirationDate ? d.expirationDate.toISOString() : null,
        expired: expiresMs !== null && expiresMs < now,
        expiringSoon: expiresMs !== null && expiresMs >= now && expiresMs <= now + EXPIRING_WINDOW_MS,
      };
    });

    const lastSubmission = asset.checklistSubmissions[0];
    const lastChecklist = lastSubmission
      ? { templateName: lastSubmission.template.name, submittedAt: lastSubmission.createdAt.toISOString() }
      : null;

    // GAP 3: la ficha pública (sin autenticación) no filtra datos personales ni el
    // identificador. Expone info no sensible + prueba de documentación y última
    // inspección (sin archivos ni respuestas del checklist).
    return {
      code: asset.code,
      type: asset.type,
      name: asset.name,
      description: asset.description,
      manufacturer: asset.manufacturer,
      vehicleSubtype: asset.vehicleSubtype,
      status: asset.status,
      project: asset.project ? { name: asset.project.name } : null,
      documents,
      lastChecklist,
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

    // Cualquier cambio MANUAL de estado sobre un activo en uso es un override de
    // gestión: se libera y se cierra el ciclo activo (no solo al pasar a no operativo).
    // EN_USO/EN_PREPARACION los maneja el flujo del ciclo, no este modal, así que se
    // excluyen para no liberar por un no-op.
    const needsRelease =
      !!asset.inUseById &&
      dto.status !== AssetStatus.EN_USO &&
      dto.status !== AssetStatus.EN_PREPARACION;

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
        // Cierra el ciclo de uso activo en la MISMA transacción: si no, el ciclo
        // quedaría huérfano (EN_CURSO/EN_PREPARACION) y "terminar uso" sacaría al
        // activo del estado no operativo sin permiso de gestión.
        await tx.usageCycle.updateMany({
          where: {
            assetId: id,
            status: { in: [UsageCycleStatus.EN_PREPARACION, UsageCycleStatus.EN_CURSO] },
          },
          data: { status: UsageCycleStatus.CERRADO, endedAt: new Date() },
        });
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
   * Disputa "en uso": toma un activo para utilizarlo. Autoriza en el service
   * (patrón híbrido ADR-0001): `asset:use:report` funcional o visibilidad del
   * activo como respaldo.
   */
  async takeUse(id: string, userId: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    await this.assertCanReportUse(userId, asset);

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
   * Disputa "en uso": libera el activo. Mismo gate de entrada que `takeUse`
   * (`asset:use:report` o visibilidad); además conserva la regla de negocio:
   * solo libera quien lo tiene en uso o un org_admin.
   */
  async releaseUse(id: string, userId: string): Promise<AssetView> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }

    await this.assertCanReportUse(userId, asset);

    if (!asset.inUseById) {
      throw new BadRequestException('El activo no se encuentra en uso actualmente.');
    }

    // Permitir liberar si es el usuario en uso o el administrador global. Liberar el
    // PROPIO activo no depende de OpenFGA: solo si lo tiene otro se consulta el escape
    // de admin, resuelto por FGA (ADR-0001: PermissionService/FGA es el punto de
    // decisión, no se lee Membership.roleKey directamente).
    if (asset.inUseById !== userId) {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: `organization:${ORG_ID}`,
      });
      if (!isGlobalAdmin) {
        throw new BadRequestException('No puedes liberar un activo tomado por otro colaborador.');
      }
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

  // ============ Ciclo de uso (reportar uso -> checklist -> en uso -> terminar) ============

  private readonly usageCycleInclude = { user: true, handoffTo: true } as const;

  /** Mapea una fila UsageCycle (con user/handoffTo) a la vista del frontend. */
  private toUsageCycleView(
    row: Prisma.UsageCycleGetPayload<{ include: { user: true; handoffTo: true } }>,
  ): UsageCycleView {
    const person = (
      u: { id: string; firstName: string; lastName: string } | null,
    ): { id: string; firstName: string; lastName: string } | null =>
      u ? { id: u.id, firstName: u.firstName, lastName: u.lastName } : null;
    return {
      id: row.id,
      assetId: row.assetId,
      userId: row.userId,
      user: person(row.user),
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      checklistSubmissionId: row.checklistSubmissionId,
      startPhotoUrl: row.startPhotoUrl,
      endPhotoUrl: row.endPhotoUrl,
      endKind: row.endKind,
      endLatitude: row.endLatitude,
      endLongitude: row.endLongitude,
      endText: row.endText,
      handoffToUserId: row.handoffToUserId,
      handoffTo: person(row.handoffTo),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** ¿Tiene el activo una plantilla de checklist APROBADA (flujo con checklist inicial)? */
  private async hasApprovedChecklist(assetId: string): Promise<boolean> {
    const tpl = await this.prisma.checklistTemplate.findUnique({ where: { assetId } });
    return !!tpl && tpl.status === DocumentStatus.APROBADO;
  }

  /** Guarda una foto del ciclo en el storage (carpeta propia del activo). */
  private async saveUsageCyclePhoto(
    assetId: string,
    photo: UsageCyclePhotoInput,
  ): Promise<{ url: string; key: string }> {
    return this.storage.save({
      buffer: photo.buffer,
      filename: photo.filename,
      contentType: photo.contentType,
      folder: `assets/${assetId}/usage-cycles`,
    });
  }

  /** Carga un ciclo del activo y exige que el usuario sea su dueño o un admin global. */
  private async loadOwnCycle(
    assetId: string,
    cycleId: string,
    userId: string,
  ): Promise<Prisma.UsageCycleGetPayload<Record<string, never>>> {
    const cycle = await this.prisma.usageCycle.findUnique({ where: { id: cycleId } });
    if (!cycle || cycle.assetId !== assetId) {
      throw new NotFoundException('El ciclo de uso no existe.');
    }
    if (cycle.userId !== userId) {
      const isGlobalAdmin = await this.fga.check({
        user: `user:${userId}`,
        relation: 'admin',
        object: `organization:${ORG_ID}`,
      });
      if (!isGlobalAdmin) {
        throw new ForbiddenException(
          'Solo quien tiene el uso o un administrador puede gestionar el ciclo.',
        );
      }
    }
    return cycle;
  }

  /** Re-lee el activo y el ciclo para la respuesta de las mutaciones. */
  private async loadUsageCycleResult(assetId: string, cycleId: string): Promise<UsageCycleResult> {
    const [assetRow, cycleRow] = await Promise.all([
      this.prisma.asset.findUniqueOrThrow({
        where: { id: assetId },
        include: { project: true, assignedTo: true, inUseBy: true },
      }),
      this.prisma.usageCycle.findUniqueOrThrow({
        where: { id: cycleId },
        include: this.usageCycleInclude,
      }),
    ]);
    return { asset: this.toAssetView(assetRow), cycle: this.toUsageCycleView(cycleRow) };
  }

  /**
   * Reportar uso: reclama el activo (atómico) y abre un ciclo. Si el activo tiene un
   * checklist APROBADO queda EN_PREPARACION (a la espera de firmar en `confirm`); si no,
   * pasa directo a EN_USO (ciclo EN_CURSO). Foto inicial opcional. Mismo gate que
   * takeUse (asset:use:report + visibilidad).
   */
  async startUsageCycle(
    assetId: string,
    userId: string,
    photo?: UsageCyclePhotoInput,
  ): Promise<UsageCycleResult> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException('El activo no existe.');
    }
    await this.assertCanReportUse(userId, asset);
    if (NON_OPERATIONAL_STATUSES.includes(asset.status)) {
      throw new BadRequestException('El activo no está disponible para su uso.');
    }

    const withChecklist = await this.hasApprovedChecklist(assetId);
    const startPhoto = photo ? await this.saveUsageCyclePhoto(assetId, photo) : null;
    const now = new Date();

    const cycleId = await this.prisma.$transaction(async (tx) => {
      // Reclamo ATÓMICO: inUseById:null Y estado operativo van en el mismo UPDATE, para
      // que un cambio concurrente a un estado no operativo (MANTENIMIENTO, etc.) no se
      // pierda por TOCTOU entre la lectura y el reclamo.
      const claimed = await tx.asset.updateMany({
        where: {
          id: assetId,
          inUseById: null,
          status: { notIn: NON_OPERATIONAL_STATUSES },
        },
        data: {
          inUseById: userId,
          inUseSince: now,
          status: withChecklist ? AssetStatus.EN_PREPARACION : AssetStatus.EN_USO,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('El activo ya está en uso por otro colaborador.');
      }
      const cycle = await tx.usageCycle.create({
        data: {
          assetId,
          userId,
          status: withChecklist ? UsageCycleStatus.EN_PREPARACION : UsageCycleStatus.EN_CURSO,
          startedAt: now,
          confirmedAt: withChecklist ? null : now,
          startPhotoUrl: startPhoto?.url ?? null,
          startPhotoKey: startPhoto?.key ?? null,
        },
      });
      await this.createHistoryEntry(
        tx,
        assetId,
        'CICLO',
        withChecklist
          ? 'Reportó uso; en preparación (checklist pendiente).'
          : 'Reportó uso; activo en uso.',
        userId,
      );
      return cycle.id;
    });

    return this.loadUsageCycleResult(assetId, cycleId);
  }

  /**
   * Confirmar uso: firma el checklist inicial de un ciclo EN_PREPARACION. Reusa
   * submitChecklist (gates, plantilla APROBADA, odómetro, detección de falla) y liga la
   * ChecklistSubmission al ciclo. Si el checklist reporta falla (submitChecklist deja el
   * activo en MANTENIMIENTO) el ciclo se CANCELA y se libera; si no, el activo pasa a
   * EN_USO y el ciclo a EN_CURSO.
   */
  async confirmUsageCycle(
    assetId: string,
    cycleId: string,
    userId: string,
    templateId: string,
    answers: Record<string, unknown>[],
  ): Promise<UsageCycleResult> {
    const cycle = await this.prisma.usageCycle.findUnique({ where: { id: cycleId } });
    if (!cycle || cycle.assetId !== assetId) {
      throw new NotFoundException('El ciclo de uso no existe.');
    }
    if (cycle.userId !== userId) {
      throw new ForbiddenException('Solo quien reportó el uso puede confirmarlo.');
    }
    if (cycle.status !== UsageCycleStatus.EN_PREPARACION) {
      throw new ConflictException('El ciclo ya no está en preparación.');
    }

    const submission = await this.submitChecklist(assetId, templateId, userId, answers);
    const asset = await this.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    const failed = asset.status === AssetStatus.MANTENIMIENTO;

    await this.prisma.$transaction(async (tx) => {
      // Avance ATÓMICO del ciclo: updateMany condicionado a que siga EN_PREPARACION. Si
      // otro confirm concurrente ya lo avanzó (count 0), esta submission es duplicada:
      // se borra y no se toca el activo (idempotencia ante doble envío).
      const advanced = await tx.usageCycle.updateMany({
        where: { id: cycleId, status: UsageCycleStatus.EN_PREPARACION },
        data: failed
          ? {
              status: UsageCycleStatus.CANCELADO,
              endedAt: new Date(),
              checklistSubmissionId: submission.id,
            }
          : {
              status: UsageCycleStatus.EN_CURSO,
              confirmedAt: new Date(),
              checklistSubmissionId: submission.id,
            },
      });
      if (advanced.count === 0) {
        await tx.checklistSubmission
          .delete({ where: { id: submission.id } })
          .catch(() => undefined);
        return;
      }
      if (failed) {
        // Checklist con falla: el activo ya quedó en mantenimiento; el ciclo se cancela y se libera.
        await tx.asset.update({
          where: { id: assetId },
          data: { inUseById: null, inUseSince: null },
        });
        await this.createHistoryEntry(
          tx,
          assetId,
          'CICLO',
          'Checklist con falla: activo a mantenimiento, ciclo cancelado.',
          userId,
        );
      } else {
        await tx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.EN_USO } });
        await this.createHistoryEntry(tx, assetId, 'CICLO', 'Confirmó uso; activo en uso.', userId);
      }
    });

    return this.loadUsageCycleResult(assetId, cycleId);
  }

  /** Cancelar un ciclo EN_PREPARACION (antes de confirmar): libera el activo. */
  async cancelUsageCycle(
    assetId: string,
    cycleId: string,
    userId: string,
  ): Promise<UsageCycleResult> {
    const cycle = await this.loadOwnCycle(assetId, cycleId, userId);
    if (cycle.status !== UsageCycleStatus.EN_PREPARACION) {
      throw new ConflictException('Solo se puede cancelar un ciclo en preparación.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: assetId },
        data: { inUseById: null, inUseSince: null, status: AssetStatus.DISPONIBLE },
      });
      await tx.usageCycle.update({
        where: { id: cycleId },
        data: { status: UsageCycleStatus.CANCELADO, endedAt: new Date() },
      });
      await this.createHistoryEntry(
        tx,
        assetId,
        'CICLO',
        'Canceló el ciclo de uso; activo disponible.',
        userId,
      );
    });
    return this.loadUsageCycleResult(assetId, cycleId);
  }

  /**
   * Terminar uso: cierra un ciclo EN_CURSO con la forma de cierre (GPS / estacionamiento
   * / traspaso) y foto opcional. El activo queda DISPONIBLE también en traspaso: el otro
   * usuario reportará su propio uso y checklist (decisión de producto). Dueño o admin.
   */
  async endUsageCycle(
    assetId: string,
    cycleId: string,
    userId: string,
    dto: EndUsageCycleInput,
    photo?: UsageCyclePhotoInput,
  ): Promise<UsageCycleResult> {
    const cycle = await this.loadOwnCycle(assetId, cycleId, userId);
    if (cycle.status !== UsageCycleStatus.EN_CURSO) {
      throw new ConflictException('Solo se puede terminar un ciclo en uso.');
    }

    let handoffToUserId: string | null = null;
    if (dto.endKind === 'TRASPASO') {
      if (!dto.handoffToUserId) {
        throw new BadRequestException('Indica el usuario al que traspasas el activo.');
      }
      const target = await this.prisma.user.findUnique({ where: { id: dto.handoffToUserId } });
      if (!target) {
        throw new BadRequestException('El usuario del traspaso no existe.');
      }
      handoffToUserId = target.id;
    }

    const endPhoto = photo ? await this.saveUsageCyclePhoto(assetId, photo) : null;
    // Si mientras estaba en uso el activo cayó a un estado no operativo (p.ej. un
    // checklist de gestión reportó falla -> MANTENIMIENTO), terminar el uso NO debe
    // devolverlo a DISPONIBLE: se respeta el estado no operativo y solo se libera.
    const current = await this.prisma.asset.findUniqueOrThrow({
      where: { id: assetId },
      select: { status: true },
    });
    const keepStatus = NON_OPERATIONAL_STATUSES.includes(current.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: assetId },
        data: {
          inUseById: null,
          inUseSince: null,
          ...(keepStatus ? {} : { status: AssetStatus.DISPONIBLE }),
        },
      });
      await tx.usageCycle.update({
        where: { id: cycleId },
        data: {
          status: UsageCycleStatus.CERRADO,
          endedAt: new Date(),
          endKind: dto.endKind,
          endLatitude: dto.endKind === 'GPS' ? dto.latitude ?? null : null,
          endLongitude: dto.endKind === 'GPS' ? dto.longitude ?? null : null,
          endText: dto.endKind === 'ESTACIONAMIENTO' ? dto.text ?? null : null,
          handoffToUserId,
          endPhotoUrl: endPhoto?.url ?? null,
          endPhotoKey: endPhoto?.key ?? null,
        },
      });
      await this.createHistoryEntry(
        tx,
        assetId,
        'CICLO',
        handoffToUserId
          ? 'Terminó uso; traspasó el activo.'
          : keepStatus
            ? `Terminó uso; el activo queda en ${current.status}.`
            : 'Terminó uso; activo disponible.',
        userId,
      );
    });

    return this.loadUsageCycleResult(assetId, cycleId);
  }

  /** Historial de ciclos de uso del activo (más recientes primero). Requiere ver el activo. */
  async listUsageCycles(assetId: string, userId: string): Promise<UsageCycleView[]> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || !(await this.canViewAsset(userId, asset))) {
      throw new NotFoundException('El activo no existe o no tienes acceso.');
    }
    const rows = await this.prisma.usageCycle.findMany({
      where: { assetId },
      include: this.usageCycleInclude,
      orderBy: { startedAt: 'desc' },
    });
    return rows.map((r) => this.toUsageCycleView(r));
  }

  /** Detalle de un ciclo de uso puntual. Requiere ver el activo. */
  async getUsageCycle(assetId: string, cycleId: string, userId: string): Promise<UsageCycleView> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || !(await this.canViewAsset(userId, asset))) {
      throw new NotFoundException('El activo no existe o no tienes acceso.');
    }
    const row = await this.prisma.usageCycle.findUnique({
      where: { id: cycleId },
      include: this.usageCycleInclude,
    });
    if (!row || row.assetId !== assetId) {
      throw new NotFoundException('El ciclo de uso no existe.');
    }
    return this.toUsageCycleView(row);
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
      // Normaliza (legacy → union nuevo) con el mismo camino del submit para que
      // una plantilla histórica (YES_NO/NUMBER/TEXT) llegue al front con tipos
      // nuevos y la ejecución dibuje los inputs correctos. Es idempotente.
      items: this.readTemplateItems(row.items),
      status: row.status,
      previousItems: row.previousItems ? this.readTemplateItems(row.previousItems) : null,
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

  /**
   * Plantilla por defecto de camioneta como módulo TS tipado (Tanda 5). Antes se
   * leía del CSV histórico; ahora la fuente del shape nuevo es
   * `DEFAULT_VEHICLE_CHECKLIST` (misma definición en backend y front).
   */
  private loadDefaultVehicleChecklist(): ChecklistTemplateItem[] {
    return DEFAULT_VEHICLE_CHECKLIST;
  }

  /**
   * Normaliza (legacy → union nuevo) y valida los ítems de una plantilla con
   * Zod. Traduce `ZodError` a `BadRequestException` con el primer mensaje claro.
   */
  private validateTemplateItems(items: Record<string, unknown>[]): ChecklistTemplateItem[] {
    try {
      return parseTemplateItems(items);
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues[0]?.message ?? 'Los ítems del checklist son inválidos.';
        throw new BadRequestException(`Checklist inválido: ${message}`);
      }
      throw error;
    }
  }

  /**
   * Valida las respuestas de una ejecución de checklist con Zod. Traduce
   * `ZodError` a `BadRequestException` con el primer mensaje claro.
   */
  private validateAnswers(answers: Record<string, unknown>[]): ChecklistAnswer[] {
    try {
      return submitAnswersSchema.parse(answers);
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues[0]?.message ?? 'Las respuestas del checklist son inválidas.';
        throw new BadRequestException(`Respuestas inválidas: ${message}`);
      }
      throw error;
    }
  }

  /**
   * Lee y normaliza (legacy → union nuevo) los ítems de una plantilla ya
   * persistida para la lógica de falla/odómetro. Tolerante: si una plantilla
   * histórica no valida, registra el aviso y devuelve `[]` en lugar de romper la
   * ejecución (el fallback legacy sigue detectando un booleano `false`).
   */
  private readTemplateItems(raw: Prisma.JsonValue | null): ChecklistTemplateItem[] {
    try {
      return parseTemplateItems(raw);
    } catch (error) {
      this.logger.warn(
        `Plantilla de checklist con shape inválido; se ignoran los ítems para la detección de falla. ${
          error instanceof ZodError ? error.issues[0]?.message ?? '' : ''
        }`,
      );
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

    // Normaliza (legacy → union nuevo) y valida ANTES de persistir. Los ítems se
    // guardan ya normalizados; así el shape nuevo se propaga sin migrar la BD.
    const normalizedItems = this.validateTemplateItems(items);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.checklistTemplate.update({
        where: { assetId },
        data: {
          name,
          items: normalizedItems as unknown as Prisma.InputJsonValue,
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
      answers: row.answers as unknown as ChecklistAnswer[],
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
    // Ejecutar el checklist es una ESCRITURA: además de poder ejecutarlo, exige poder
    // VER el activo. El rol conductor tiene asset:checklist:run:any GLOBAL sin
    // asset:read, así que sin este chequeo escribiría el checklist de un activo de otro
    // proyecto que ni siquiera ve (misma asimetría que assertCanReportUse cierra en
    // tomar/liberar). Los vehículos de flota (globales) siguen visibles para el conductor.
    if (!(await this.canViewAsset(userId, asset))) {
      throw new ForbiddenException('No tienes acceso a este activo.');
    }

    const template = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.assetId !== assetId) {
      throw new NotFoundException('La plantilla no corresponde a este activo.');
    }
    if (template.status !== DocumentStatus.APROBADO) {
      throw new BadRequestException('Solo se pueden enviar checklists basados en plantillas aprobadas.');
    }

    // Valida las respuestas con Zod ANTES de persistir. Los ítems de la plantilla
    // se leen normalizados (legacy → union nuevo) para la lógica de falla/odómetro.
    const parsedAnswers = this.validateAnswers(answers);
    const templateItems = this.readTemplateItems(template.items);
    const itemById = new Map(templateItems.map((item) => [item.id, item] as const));
    const answerByItemId = new Map(parsedAnswers.map((answer) => [answer.itemId, answer] as const));

    // Odómetro: detecta el ítem por (ENTERO && (isOdometer || id==='kilometraje'))
    // en VEHICULO; conserva la regla monótona y la metadata.odometerKm.
    let updatedOdometerKm: number | null = null;
    if (asset.type === AssetType.VEHICULO) {
      const odometerItem = templateItems.find(
        (item) =>
          item.type === 'ENTERO' &&
          (item.config?.isOdometer === true ||
            item.id === 'kilometraje' ||
            /kil[oó]metraje|od[oó]metro/i.test(item.label ?? '')),
      );
      const odometerAns = odometerItem ? answerByItemId.get(odometerItem.id) : undefined;
      if (odometerAns && odometerAns.value !== null && odometerAns.value !== '') {
        const reportedKm = Number(odometerAns.value);
        if (Number.isNaN(reportedKm)) {
          throw new BadRequestException('El valor de kilometraje reportado debe ser un número.');
        }

        const currentMeta = (asset.metadata as Record<string, unknown> | null) ?? {};
        const currentKm = Number(currentMeta.odometerKm ?? 0);
        if (reportedKm < currentKm) {
          throw new BadRequestException(
            `El kilometraje reportado (${reportedKm} km) no puede ser menor al kilometraje actual (${currentKm} km).`,
          );
        }
        updatedOdometerKm = reportedKm;
      }
    }

    // Detección de falla generalizada (isFailure) + observación companion.
    let hasFailure = false;
    let failureDetail = '';
    for (const item of templateItems) {
      const answer = answerByItemId.get(item.id);
      const value = answer ? answer.value : null;
      const valueMissing = value === null || (typeof value === 'string' && value.trim() === '');

      // Obligatoriedad: un ítem `required` debe venir respondido con un valor no
      // vacío. Los ítems TEXTO companion son `required:false`, así que no se ven
      // afectados.
      if (item.required && valueMissing) {
        throw new BadRequestException(`Debes responder el ítem obligatorio "${item.label}".`);
      }

      // El valor de un ESTADO respondido debe pertenecer a `config.options`
      // (case-insensitive). Se saltan las respuestas vacías (la obligatoriedad ya
      // se validó arriba).
      if (item.type === 'ESTADO' && !valueMissing) {
        const options = item.config?.options ?? [];
        const valueText = String(value).toLowerCase();
        const isValidOption = options.some((option) => option.toLowerCase() === valueText);
        if (!isValidOption) {
          throw new BadRequestException(
            `El valor "${value}" no es una opción válida para "${item.label}".`,
          );
        }
      }

      const failed = isFailure(item, value);

      // Observación companion: si un ítem cae en falla o exige observación
      // (config.requireObs), el answer del obsItemId debe traer un valor no vacío.
      // Es type-agnóstico: aplica a cualquier ítem que declare `config.obsItemId`.
      if (item.config?.obsItemId && (failed || item.config?.requireObs === true)) {
        const obsAnswer = answerByItemId.get(item.config.obsItemId);
        const obsValue = obsAnswer?.value;
        const obsEmpty =
          obsValue === null ||
          obsValue === undefined ||
          (typeof obsValue === 'string' && obsValue.trim() === '');
        if (obsEmpty) {
          throw new BadRequestException(`Debes registrar una observación para "${item.label}".`);
        }
      }

      if (failed && !hasFailure) {
        hasFailure = true;
        failureDetail = item.label || item.id;
      }
    }

    // Fallback legacy: un booleano `false` de una respuesta sin ítem en la
    // plantilla (plantilla vacía / respuesta histórica) sigue contando como falla.
    if (!hasFailure) {
      for (const answer of parsedAnswers) {
        if (!itemById.has(answer.itemId) && answer.value === false) {
          hasFailure = true;
          failureDetail = answer.label || answer.itemId;
          break;
        }
      }
    }

    const submission = await this.prisma.$transaction(async (tx) => {
      const row = await tx.checklistSubmission.create({
        data: {
          assetId,
          templateId,
          userId,
          answers: parsedAnswers as unknown as Prisma.InputJsonValue,
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
    // Escritura: exige poder VER el activo (ver submitChecklist). Evita que el rol
    // conductor (asset:checklist:run:any GLOBAL sin asset:read) sobrescriba la
    // telemetría de un vehículo de otro proyecto que no puede ver.
    if (!(await this.canViewAsset(userId, asset))) {
      throw new ForbiddenException('No tienes acceso a este activo.');
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
