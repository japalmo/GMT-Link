import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupplyRequestStatus } from '@prisma/client';
import type {
  Prisma,
  Provider,
  Supply,
  SupplyAssignment,
  SupplyProvider,
  SupplyRequest,
  SupplyRequestItem,
  User,
  Warehouse,
  WarehouseStock,
} from '@prisma/client';
import type {
  CreateSupplyRequestInput,
  InventoryCatalogItem,
  InventoryImportResult,
  InventoryItemDetail,
  InventoryItemView,
  SupplyAssignmentView,
  SupplyProviderLinkView,
  SupplyRequestView,
  TablePage,
  TableRequest,
} from '@gmt-platform/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import {
  tableAndWhere,
  tableOrderBy,
  tablePage,
  tableSearchWhere,
  tableSkipTake,
} from '../../common/table-pagination.util';
import {
  CreateInventoryItemDto,
  DeliverRequestDto,
  ImportInventoryDto,
  LinkProviderDto,
  RejectRequestDto,
  UpdateInventoryItemDto,
  UpdateProviderLinkDto,
} from './dto/inventory.dto';

/** Motivo de las ENTRY del import masivo de Inventario (traza en el kardex de bodega). */
const IMPORT_ENTRY_REASON = 'Carga inicial masiva (Inventario)';

/** Motivo de las EXIT al entregar una solicitud de insumos. */
const DELIVERY_EXIT_REASON = 'Entrega de solicitud de insumos';

/**
 * Proyección mínima del usuario en los joins: SOLO nombre y apellido. Nunca se
 * trae la fila completa de User (passwordHash, tokenVersion, etc.) a memoria.
 */
const USER_NAME_SELECT = { select: { firstName: true, lastName: true } } as const;

/** Nombre visible del usuario en las vistas (lo único que hidratan los joins). */
type UserName = Pick<User, 'firstName' | 'lastName'>;

/** Fila de artículo con lo necesario para computar totalStock y providerCount. */
type SupplyRow = Supply & {
  stocks: Array<Pick<WarehouseStock, 'quantity'>>;
  _count: { supplyProviders: number };
};

type RequestRow = SupplyRequest & {
  user: UserName | null;
  items: Array<SupplyRequestItem & { supply: Supply }>;
};

type AssignmentRow = SupplyAssignment & {
  supply: Supply;
  deliveredBy: UserName | null;
  /** Solo lo incluye el historial completo (assignments/table): trabajador receptor. */
  user?: UserName | null;
};

/**
 * Módulo Inventario: catálogo de artículos (Supply ampliado), import masivo por
 * CSV, proveedores por artículo y solicitudes de insumos con entrega que descuenta
 * stock. Los gates (`inventory:access` para la gestión, `inventory:request:own`
 * para catálogo/solicitudes propias) viven en el controller; los métodos `me*`
 * reciben SIEMPRE el userId de la sesión (nunca del body).
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============ Catálogo de artículos ============

  /**
   * Catálogo con el MOTOR de tablas server-side (offset): búsqueda por
   * code/name/brand/model (insensitive), filtro por categoría y orden permitido
   * (nombre/código/categoría/creado) con desempate por id. Cada fila agrega el
   * stock total (suma de bodegas) y la cantidad de proveedores vinculados.
   */
  async listItemsTable(req: TableRequest): Promise<TablePage<InventoryItemView>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);

    const searchWhere = tableSearchWhere<Prisma.SupplyWhereInput>(req.search, [
      'code',
      'name',
      'brand',
      'model',
    ]);

    const filters = req.filters ?? {};
    // El query string puede llegar anidado (qs): se coacciona a string para
    // degradar a "filtro ignorado" en vez de romper la consulta con un 500.
    const category = typeof filters.category === 'string' ? filters.category.trim() : '';
    const categoryWhere: Prisma.SupplyWhereInput | undefined = category
      ? { category }
      : undefined;

    const where = tableAndWhere<Prisma.SupplyWhereInput>(searchWhere, categoryWhere) ?? {};

    const orderBy = tableOrderBy<Prisma.SupplyOrderByWithRelationInput[]>(
      req,
      {
        nombre: (dir) => [{ name: dir }, { id: 'desc' }],
        codigo: (dir) => [{ code: dir }, { id: 'desc' }],
        categoria: (dir) => [{ category: dir }, { name: 'asc' }, { id: 'desc' }],
        creado: (dir) => [{ createdAt: dir }, { id: 'desc' }],
      },
      [{ name: 'asc' }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supply.findMany({
        where,
        include: {
          stocks: { select: { quantity: true } },
          _count: { select: { supplyProviders: true } },
        },
        orderBy,
        skip,
        take,
      }),
      this.prisma.supply.count({ where }),
    ]);

    return tablePage(
      rows.map((r) => this.toItemView(r as SupplyRow)),
      total,
      page,
      pageSize,
    );
  }

  /** Crea un artículo individual. Crear NO implica stock. 409 si el código ya existe. */
  async createItem(dto: CreateInventoryItemDto): Promise<InventoryItemView> {
    const existing = await this.prisma.supply.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Ya existe un artículo con el código "${dto.code}".`);
    }

    const row = await this.prisma.supply.create({
      data: {
        code: dto.code,
        name: dto.name,
        brand: dto.brand || null,
        category: dto.category || null,
        color: dto.color || null,
        size: dto.size || null,
        model: dto.model || null,
        unit: dto.unit || 'unidades',
        description: dto.description || null,
      },
      include: {
        stocks: { select: { quantity: true } },
        _count: { select: { supplyProviders: true } },
      },
    });

    return this.toItemView(row as SupplyRow);
  }

  /** Edita los campos descriptivos de un artículo (el code no se toca por acá). */
  async updateItem(id: string, dto: UpdateInventoryItemDto): Promise<InventoryItemView> {
    const existing = await this.prisma.supply.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('El artículo no existe.');
    }

    const data: Prisma.SupplyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.brand !== undefined) data.brand = dto.brand || null;
    if (dto.category !== undefined) data.category = dto.category || null;
    if (dto.color !== undefined) data.color = dto.color || null;
    if (dto.size !== undefined) data.size = dto.size || null;
    if (dto.model !== undefined) data.model = dto.model || null;
    if (dto.unit !== undefined) data.unit = dto.unit || 'unidades';
    if (dto.description !== undefined) data.description = dto.description || null;

    const row = await this.prisma.supply.update({
      where: { id },
      data,
      include: {
        stocks: { select: { quantity: true } },
        _count: { select: { supplyProviders: true } },
      },
    });

    return this.toItemView(row as SupplyRow);
  }

  /** Detalle de un artículo: stocks por bodega + total + proveedores vinculados. */
  async getItemDetail(id: string): Promise<InventoryItemDetail> {
    const row = await this.prisma.supply.findUnique({
      where: { id },
      include: {
        stocks: { include: { warehouse: true }, orderBy: { warehouse: { name: 'asc' } } },
        supplyProviders: { include: { provider: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) {
      throw new NotFoundException('El artículo no existe.');
    }

    const stocks = row.stocks as Array<WarehouseStock & { warehouse: Warehouse }>;
    const links = row.supplyProviders as Array<SupplyProvider & { provider: Provider }>;

    return {
      ...this.toItemView({
        ...row,
        stocks: stocks.map((s) => ({ quantity: s.quantity })),
        _count: { supplyProviders: links.length },
      }),
      stocks: stocks.map((s) => ({
        warehouseId: s.warehouseId,
        warehouseName: s.warehouse.name,
        warehouseCode: s.warehouse.code,
        quantity: s.quantity,
      })),
      providers: links.map((l) => this.toProviderLinkView(l)),
    };
  }

  /**
   * Import masivo (CSV): upsert por `code` (si existe, actualiza los descriptivos)
   * y carga inicial de stock opcional en hasta 4 bodegas resueltas POR CÓDIGO.
   * Cada fila es atómica: si su bodega no existe (u otra falla), la fila completa
   * se revierte y queda en `errors` SIN abortar el lote (el CSV se corrige y se
   * re-importa: el upsert lo hace idempotente).
   */
  async importItems(actorId: string, dto: ImportInventoryDto): Promise<InventoryImportResult> {
    let created = 0;
    let updated = 0;
    const errors: Array<{ code: string; message: string }> = [];

    for (const item of dto.items) {
      try {
        const outcome = await this.prisma.$transaction(async (prismaTx) => {
          const existing = await prismaTx.supply.findUnique({ where: { code: item.code } });

          const descriptivos = {
            name: item.name,
            brand: item.brand || null,
            category: item.category || null,
            color: item.color || null,
            size: item.size || null,
            model: item.model || null,
            unit: item.unit || 'unidades',
            description: item.description || null,
          };

          const supply = existing
            ? await prismaTx.supply.update({ where: { code: item.code }, data: descriptivos })
            : await prismaTx.supply.create({ data: { code: item.code, ...descriptivos } });

          for (const stock of item.stocks ?? []) {
            if (stock.quantity <= 0) continue;

            const warehouse = await prismaTx.warehouse.findUnique({
              where: { code: stock.warehouseCode },
            });
            if (!warehouse) {
              throw new BadRequestException(
                `La bodega con código "${stock.warehouseCode}" no existe.`,
              );
            }

            const currentStock = await prismaTx.warehouseStock.findUnique({
              where: {
                warehouseId_supplyId: { warehouseId: warehouse.id, supplyId: supply.id },
              },
            });
            const nextQty = (currentStock?.quantity || 0) + stock.quantity;

            await prismaTx.warehouseStock.upsert({
              where: {
                warehouseId_supplyId: { warehouseId: warehouse.id, supplyId: supply.id },
              },
              create: { warehouseId: warehouse.id, supplyId: supply.id, quantity: nextQty },
              update: { quantity: nextQty },
            });

            await prismaTx.warehouseTransaction.create({
              data: {
                warehouseId: warehouse.id,
                supplyId: supply.id,
                type: 'ENTRY',
                quantity: stock.quantity,
                reason: IMPORT_ENTRY_REASON,
                actorId,
              },
            });
          }

          return existing ? 'updated' : 'created';
        });

        if (outcome === 'created') created++;
        else updated++;
      } catch (error: unknown) {
        // Solo los mensajes CONTROLADOS (HttpException, ya en es-CL) se reflejan
        // al cliente; un fallo interno (Prisma, timeout) se registra completo en
        // el log y la fila queda con un mensaje genérico legible.
        if (error instanceof HttpException) {
          errors.push({ code: item.code, message: error.message });
        } else {
          this.logger.error(
            `Fila "${item.code}" del import de inventario falló: ${
              error instanceof Error ? error.message : String(error)
            }`,
            error instanceof Error ? error.stack : undefined,
          );
          errors.push({
            code: item.code,
            message: 'No se pudo importar esta fila. Verifica los datos e intenta de nuevo.',
          });
        }
      }
    }

    return { created, updated, errors };
  }

  // ============ Proveedores por artículo ============

  /** Vincula un proveedor al artículo. 409 si ya está vinculado. */
  async linkProvider(supplyId: string, dto: LinkProviderDto): Promise<SupplyProviderLinkView> {
    const supply = await this.prisma.supply.findUnique({ where: { id: supplyId } });
    if (!supply) {
      throw new NotFoundException('El artículo no existe.');
    }
    const provider = await this.prisma.provider.findUnique({ where: { id: dto.providerId } });
    if (!provider) {
      throw new BadRequestException('El proveedor especificado no existe.');
    }

    const existing = await this.prisma.supplyProvider.findUnique({
      where: { supplyId_providerId: { supplyId, providerId: dto.providerId } },
    });
    if (existing) {
      throw new ConflictException('El proveedor ya está vinculado a este artículo.');
    }

    const link = await this.prisma.supplyProvider.create({
      data: {
        supplyId,
        providerId: dto.providerId,
        price: dto.price ?? null,
        url: dto.url || null,
      },
      include: { provider: true },
    });

    return this.toProviderLinkView(link as SupplyProvider & { provider: Provider });
  }

  /** Edita precio/URL de un vínculo artículo-proveedor. */
  async updateProviderLink(
    supplyId: string,
    linkId: string,
    dto: UpdateProviderLinkDto,
  ): Promise<SupplyProviderLinkView> {
    const link = await this.prisma.supplyProvider.findUnique({ where: { id: linkId } });
    if (!link || link.supplyId !== supplyId) {
      throw new NotFoundException('El vínculo con el proveedor no existe.');
    }

    const data: Prisma.SupplyProviderUpdateInput = {};
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.url !== undefined) data.url = dto.url || null;

    const row = await this.prisma.supplyProvider.update({
      where: { id: linkId },
      data,
      include: { provider: true },
    });

    return this.toProviderLinkView(row as SupplyProvider & { provider: Provider });
  }

  /** Desvincula un proveedor del artículo. */
  async unlinkProvider(supplyId: string, linkId: string): Promise<{ ok: true }> {
    const link = await this.prisma.supplyProvider.findUnique({ where: { id: linkId } });
    if (!link || link.supplyId !== supplyId) {
      throw new NotFoundException('El vínculo con el proveedor no existe.');
    }
    await this.prisma.supplyProvider.delete({ where: { id: linkId } });
    return { ok: true };
  }

  // ============ Historial de entregas (gestión) ============

  /**
   * Historial COMPLETO de entregas con el MOTOR de tablas: búsqueda insensitive
   * por nombre del artículo o del trabajador receptor, orden por fecha (default
   * desc) y cantidad con desempate id. Cada fila hidrata al trabajador (`worker`)
   * además del artículo y de quién entregó.
   */
  async listAssignmentsTable(req: TableRequest): Promise<TablePage<SupplyAssignmentView>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);

    // La búsqueda cruza relaciones (supply/user), así que se arma el OR propio
    // (tableSearchWhere solo cubre campos escalares). Se coacciona a string por
    // si el query string llega anidado (qs).
    const q = typeof req.search === 'string' ? req.search.trim() : '';
    const where: Prisma.SupplyAssignmentWhereInput = q
      ? {
          OR: [
            { supply: { name: { contains: q, mode: 'insensitive' } } },
            { user: { firstName: { contains: q, mode: 'insensitive' } } },
            { user: { lastName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {};

    const orderBy = tableOrderBy<Prisma.SupplyAssignmentOrderByWithRelationInput[]>(
      req,
      {
        fecha: (dir) => [{ createdAt: dir }, { id: 'desc' }],
        cantidad: (dir) => [{ quantity: dir }, { createdAt: 'desc' }, { id: 'desc' }],
      },
      [{ createdAt: 'desc' }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplyAssignment.findMany({
        where,
        include: { supply: true, deliveredBy: USER_NAME_SELECT, user: USER_NAME_SELECT },
        orderBy,
        skip,
        take,
      }),
      this.prisma.supplyAssignment.count({ where }),
    ]);

    return tablePage(
      rows.map((r) => this.toAssignmentView(r as AssignmentRow)),
      total,
      page,
      pageSize,
    );
  }

  // ============ Solicitudes de insumos (gestión) ============

  /**
   * TODAS las solicitudes con el MOTOR de tablas (filtro por estado, orden por
   * fecha/estado con desempate id), hidratadas con solicitante e ítems.
   */
  async listRequestsTable(req: TableRequest): Promise<TablePage<SupplyRequestView>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);

    const filters = req.filters ?? {};
    const rawStatus = typeof filters.status === 'string' ? filters.status.trim() : '';
    const where: Prisma.SupplyRequestWhereInput = {};
    if ((Object.values(SupplyRequestStatus) as string[]).includes(rawStatus)) {
      where.status = rawStatus as SupplyRequestStatus;
    }

    const orderBy = tableOrderBy<Prisma.SupplyRequestOrderByWithRelationInput[]>(
      req,
      {
        fecha: (dir) => [{ createdAt: dir }, { id: 'desc' }],
        estado: (dir) => [{ status: dir }, { createdAt: 'desc' }, { id: 'desc' }],
      },
      [{ createdAt: 'desc' }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplyRequest.findMany({
        where,
        include: { user: USER_NAME_SELECT, items: { include: { supply: true } } },
        orderBy,
        skip,
        take,
      }),
      this.prisma.supplyRequest.count({ where }),
    ]);

    return tablePage(
      rows.map((r) => this.toRequestView(r as RequestRow)),
      total,
      page,
      pageSize,
    );
  }

  /**
   * ENTREGA una solicitud PENDIENTE descontando stock de la bodega indicada.
   * Todo en una transacción: primero un CLAIM ATÓMICO del estado (updateMany
   * condicionado a PENDIENTE: solo UNA de dos entregas concurrentes lo gana; la
   * otra recibe 409 sin dobles efectos), luego se valida el stock de TODOS los
   * ítems (agregando cantidades si un artículo se repite) y recién después se
   * escribe: un 400 por stock insuficiente revierte la transacción COMPLETA,
   * claim incluido (la solicitud vuelve a quedar PENDIENTE). Por cada ítem:
   * descuento de stock + WarehouseTransaction EXIT + SupplyAssignment al
   * solicitante. El claim ya deja la solicitud ENTREGADA con decidedBy/decidedAt.
   */
  async deliverRequest(
    requestId: string,
    actorId: string,
    dto: DeliverRequestDto,
  ): Promise<SupplyRequestView> {
    const row = await this.prisma.$transaction(async (prismaTx) => {
      // Claim atómico ANTES de validar/escribir: cierra la carrera de entregas
      // dobles (dos POST /deliver concurrentes sobre la misma solicitud).
      const claimed = await prismaTx.supplyRequest.updateMany({
        where: { id: requestId, status: SupplyRequestStatus.PENDIENTE },
        data: {
          status: SupplyRequestStatus.ENTREGADA,
          decidedById: actorId,
          decidedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        const exists = await prismaTx.supplyRequest.findUnique({
          where: { id: requestId },
          select: { id: true },
        });
        if (!exists) {
          throw new NotFoundException('La solicitud no existe.');
        }
        throw new ConflictException('La solicitud ya fue resuelta (no está pendiente).');
      }

      // La fila ya refleja el claim (ENTREGADA + decidedBy/decidedAt) dentro de
      // la transacción; se hidrata una sola vez para validar y para la vista.
      const request = await prismaTx.supplyRequest.findUnique({
        where: { id: requestId },
        include: { user: USER_NAME_SELECT, items: { include: { supply: true } } },
      });
      if (!request) {
        // No debería ocurrir: el claim garantiza la fila en esta transacción.
        throw new NotFoundException('La solicitud no existe.');
      }

      const warehouse = await prismaTx.warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse) {
        throw new NotFoundException('La bodega no existe.');
      }

      // Fase 1: validar el stock disponible por artículo (cantidades agregadas
      // por si la solicitud repite un artículo en más de un ítem).
      const requiredBySupply = new Map<string, { name: string; required: number }>();
      for (const item of request.items) {
        const entry = requiredBySupply.get(item.supplyId) ?? {
          name: item.supply.name,
          required: 0,
        };
        entry.required += item.quantity;
        requiredBySupply.set(item.supplyId, entry);
      }

      const availableBySupply = new Map<string, number>();
      for (const [supplyId, { name, required }] of requiredBySupply) {
        const stock = await prismaTx.warehouseStock.findUnique({
          where: { warehouseId_supplyId: { warehouseId: dto.warehouseId, supplyId } },
        });
        const available = stock?.quantity || 0;
        if (available < required) {
          throw new BadRequestException(
            `Stock insuficiente de "${name}" en la bodega: requerido ${required}, disponible ${available}`,
          );
        }
        availableBySupply.set(supplyId, available);
      }

      // Fase 2: descuento + EXIT + asignación por ítem.
      for (const item of request.items) {
        const current = availableBySupply.get(item.supplyId) ?? 0;
        const next = current - item.quantity;
        availableBySupply.set(item.supplyId, next);

        await prismaTx.warehouseStock.upsert({
          where: {
            warehouseId_supplyId: { warehouseId: dto.warehouseId, supplyId: item.supplyId },
          },
          create: { warehouseId: dto.warehouseId, supplyId: item.supplyId, quantity: next },
          update: { quantity: next },
        });

        await prismaTx.warehouseTransaction.create({
          data: {
            warehouseId: dto.warehouseId,
            supplyId: item.supplyId,
            type: 'EXIT',
            quantity: item.quantity,
            reason: DELIVERY_EXIT_REASON,
            actorId,
          },
        });

        await prismaTx.supplyAssignment.create({
          data: {
            supplyId: item.supplyId,
            userId: request.userId,
            quantity: item.quantity,
            warehouseId: dto.warehouseId,
            deliveredById: actorId,
            requestId: request.id,
            note: dto.note || null,
          },
        });
      }

      // El claim ya dejó la solicitud ENTREGADA con decidedBy/decidedAt: la fila
      // hidratada tras el claim ES la vista final.
      return request;
    });

    return this.toRequestView(row as RequestRow);
  }

  /** RECHAZA una solicitud PENDIENTE (409 si ya fue resuelta), con motivo opcional. */
  async rejectRequest(
    requestId: string,
    actorId: string,
    dto: RejectRequestDto,
  ): Promise<SupplyRequestView> {
    const request = await this.prisma.supplyRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException('La solicitud no existe.');
    }
    if (request.status !== SupplyRequestStatus.PENDIENTE) {
      throw new ConflictException('La solicitud ya fue resuelta (no está pendiente).');
    }

    const row = await this.prisma.supplyRequest.update({
      where: { id: requestId },
      data: {
        status: SupplyRequestStatus.RECHAZADA,
        rejectionReason: dto.reason || null,
        decidedById: actorId,
        decidedAt: new Date(),
      },
      include: { user: USER_NAME_SELECT, items: { include: { supply: true } } },
    });

    return this.toRequestView(row as RequestRow);
  }

  // ============ Endpoints propios (userId SIEMPRE de la sesión) ============

  /**
   * Catálogo LIVIANO para que un trabajador arme su solicitud de insumos: forma
   * mínima (id/code/name/unit/category), ordenado por nombre. Sin stock, sin
   * proveedores ni precios: esos datos son del catálogo gateado.
   */
  async listCatalog(): Promise<InventoryCatalogItem[]> {
    return this.prisma.supply.findMany({
      select: { id: true, code: true, name: true, unit: true, category: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Mis artículos entregados, del más reciente al más antiguo. */
  async listMyAssignments(userId: string): Promise<SupplyAssignmentView[]> {
    const rows = await this.prisma.supplyAssignment.findMany({
      where: { userId },
      include: { supply: true, deliveredBy: USER_NAME_SELECT },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toAssignmentView(r as AssignmentRow));
  }

  /** Mis solicitudes de insumos con estado e ítems. */
  async listMyRequests(userId: string): Promise<SupplyRequestView[]> {
    const rows = await this.prisma.supplyRequest.findMany({
      where: { userId },
      include: { user: USER_NAME_SELECT, items: { include: { supply: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRequestView(r as RequestRow));
  }

  /** Crea una solicitud propia validando que TODOS los artículos existan. */
  async createMyRequest(
    userId: string,
    input: CreateSupplyRequestInput,
  ): Promise<SupplyRequestView> {
    const supplyIds = [...new Set(input.items.map((i) => i.supplyId))];
    const supplies = await this.prisma.supply.findMany({
      where: { id: { in: supplyIds } },
      select: { id: true },
    });
    if (supplies.length !== supplyIds.length) {
      const found = new Set(supplies.map((s) => s.id));
      const missing = supplyIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Los siguientes artículos no existen: ${missing.join(', ')}.`,
      );
    }

    const row = await this.prisma.supplyRequest.create({
      data: {
        userId,
        note: input.note || null,
        items: {
          create: input.items.map((i) => ({ supplyId: i.supplyId, quantity: i.quantity })),
        },
      },
      include: { user: USER_NAME_SELECT, items: { include: { supply: true } } },
    });

    return this.toRequestView(row as RequestRow);
  }

  // ============ Mappers ============

  private toItemView(s: SupplyRow): InventoryItemView {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      description: s.description,
      category: s.category,
      unit: s.unit,
      brand: s.brand,
      color: s.color,
      size: s.size,
      model: s.model,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      totalStock: s.stocks.reduce((sum, st) => sum + st.quantity, 0),
      providerCount: s._count.supplyProviders,
    };
  }

  private toProviderLinkView(l: SupplyProvider & { provider: Provider }): SupplyProviderLinkView {
    return {
      id: l.id,
      providerId: l.providerId,
      providerName: l.provider.name,
      price: l.price,
      url: l.url,
    };
  }

  private toRequestView(r: RequestRow): SupplyRequestView {
    return {
      id: r.id,
      userId: r.userId,
      requester: r.user ? { firstName: r.user.firstName, lastName: r.user.lastName } : null,
      status: r.status,
      note: r.note,
      rejectionReason: r.rejectionReason,
      decidedById: r.decidedById,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      items: r.items.map((i) => ({
        id: i.id,
        supplyId: i.supplyId,
        supplyCode: i.supply.code,
        supplyName: i.supply.name,
        unit: i.supply.unit,
        quantity: i.quantity,
      })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toAssignmentView(a: AssignmentRow): SupplyAssignmentView {
    const view: SupplyAssignmentView = {
      id: a.id,
      supplyId: a.supplyId,
      supplyCode: a.supply.code,
      supplyName: a.supply.name,
      unit: a.supply.unit,
      quantity: a.quantity,
      warehouseId: a.warehouseId,
      deliveredBy: a.deliveredBy
        ? { firstName: a.deliveredBy.firstName, lastName: a.deliveredBy.lastName }
        : null,
      requestId: a.requestId,
      note: a.note,
      createdAt: a.createdAt.toISOString(),
    };
    // `worker` solo se hidrata cuando la consulta incluyó al receptor
    // (historial completo); en "mis artículos" queda undefined.
    if (a.user !== undefined) {
      view.worker = a.user
        ? { firstName: a.user.firstName, lastName: a.user.lastName }
        : null;
    }
    return view;
  }
}
