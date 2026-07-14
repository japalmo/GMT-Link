import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import {
  CreateSupplyDto,
  CreateWarehouseDto,
  ImportSuppliesDto,
  RegisterTransactionDto,
} from './dto/supplies.dto';
import {
  SupplyView,
  WarehouseStockView,
  WarehouseTransactionView,
  WarehouseView,
} from './supplies.types';
import { WarehouseTransaction, Warehouse, Supply, Provider, User } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { TablePage, TableRequest } from '@gmt-platform/contracts';
import { tableOrderBy, tablePage, tableSkipTake } from '../../common/table-pagination.util';

@Injectable()
export class SuppliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
  ) {}

  async createWarehouse(dto: CreateWarehouseDto): Promise<WarehouseView> {
    const existing = await this.prisma.warehouse.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`Ya existe una bodega con el código "${dto.code}".`);
    }

    const row = await this.prisma.warehouse.create({
      data: {
        code: dto.code,
        name: dto.name,
        location: dto.location || null,
      },
    });

    return this.toWarehouseView(row);
  }

  async listWarehouses(): Promise<WarehouseView[]> {
    const rows = await this.prisma.warehouse.findMany({
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toWarehouseView(r));
  }

  async getWarehouseById(id: string): Promise<{
    warehouse: WarehouseView;
    stocks: WarehouseStockView[];
    transactions: WarehouseTransactionView[];
  }> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException('La bodega no existe.');
    }

    const stocksRaw = await this.prisma.warehouseStock.findMany({
      where: { warehouseId: id },
      include: {
        supply: {
          include: {
            provider: true,
          },
        },
      },
      orderBy: { supply: { name: 'asc' } },
    });

    const txsRaw = await this.prisma.warehouseTransaction.findMany({
      where: { warehouseId: id },
      include: {
        supply: true,
        actor: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      warehouse: this.toWarehouseView(warehouse),
      stocks: stocksRaw.map((s) => ({
        warehouseId: s.warehouseId,
        supplyId: s.supplyId,
        quantity: s.quantity,
        supply: this.toSupplyView(s.supply),
      })),
      transactions: txsRaw.map((t) => this.toTxView(t)),
    };
  }

  /**
   * Movimientos de una bodega con el MOTOR de tablas server-side (offset). Reemplaza
   * el corte a 50 de `getWarehouseById` por paginación real (los movimientos crecen
   * sin techo). Orden configurable (fecha/cantidad/tipo, default fecha desc). El
   * stock queda en `getWarehouseById` (acotado + lo consume el formulario de movimiento).
   */
  async listWarehouseTransactionsTable(
    warehouseId: string,
    req: TableRequest,
  ): Promise<TablePage<WarehouseTransactionView>> {
    const { page, pageSize, skip, take } = tableSkipTake(req);
    const where: Prisma.WarehouseTransactionWhereInput = { warehouseId };

    const orderBy = tableOrderBy<Prisma.WarehouseTransactionOrderByWithRelationInput[]>(
      req,
      {
        fecha: (dir) => [{ createdAt: dir }, { id: 'desc' }],
        cantidad: (dir) => [{ quantity: dir }, { createdAt: 'desc' }, { id: 'desc' }],
        tipo: (dir) => [{ type: dir }, { createdAt: 'desc' }, { id: 'desc' }],
      },
      [{ createdAt: 'desc' }, { id: 'desc' }],
    );

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.warehouseTransaction.findMany({
        where,
        include: { supply: true, actor: true },
        orderBy,
        skip,
        take,
      }),
      this.prisma.warehouseTransaction.count({ where }),
    ]);

    return tablePage(rows.map((t) => this.toTxView(t)), total, page, pageSize);
  }

  async createSupply(dto: CreateSupplyDto): Promise<SupplyView> {
    const existing = await this.prisma.supply.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`Ya existe un insumo con el código "${dto.code}".`);
    }

    if (dto.providerId) {
      const p = await this.prisma.provider.findUnique({ where: { id: dto.providerId } });
      if (!p) {
        throw new BadRequestException('El proveedor especificado no existe.');
      }
    }

    const row = await this.prisma.supply.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description || null,
        category: dto.category || null,
        unit: dto.unit || 'unidades',
        providerId: dto.providerId || null,
      },
      include: {
        provider: true,
      },
    });

    return this.toSupplyView(row);
  }

  async listSupplies(search?: string, category?: string): Promise<SupplyView[]> {
    const where: { category?: string; OR?: Array<Record<string, unknown>> } = {};
    if (category) {
      where.category = category;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.supply.findMany({
      where,
      include: {
        provider: true,
      },
      orderBy: { name: 'asc' },
    });

    return rows.map((r) => this.toSupplyView(r));
  }

  async registerTransaction(
    warehouseId: string,
    actorId: string,
    dto: RegisterTransactionDto,
  ): Promise<WarehouseTransactionView> {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException('La bodega no existe.');
    }

    const supply = await this.prisma.supply.findUnique({ where: { id: dto.supplyId } });
    if (!supply) {
      throw new NotFoundException('El insumo no existe.');
    }

    const tx = await this.prisma.$transaction(async (prismaTx) => {
      const currentStock = await prismaTx.warehouseStock.findUnique({
        where: {
          warehouseId_supplyId: {
            warehouseId,
            supplyId: dto.supplyId,
          },
        },
      });

      const currentQty = currentStock?.quantity || 0;
      let nextQty = currentQty;

      if (dto.type === 'ENTRY') {
        nextQty += dto.quantity;
      } else {
        if (currentQty < dto.quantity) {
          throw new BadRequestException(
            `Stock insuficiente en bodega "${warehouse.name}". Requerido: ${dto.quantity}, Disponible: ${currentQty}`,
          );
        }
        nextQty -= dto.quantity;
      }

      await prismaTx.warehouseStock.upsert({
        where: {
          warehouseId_supplyId: {
            warehouseId,
            supplyId: dto.supplyId,
          },
        },
        create: {
          warehouseId,
          supplyId: dto.supplyId,
          quantity: nextQty,
        },
        update: {
          quantity: nextQty,
        },
      });

      const transaction = await prismaTx.warehouseTransaction.create({
        data: {
          warehouseId,
          supplyId: dto.supplyId,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason || null,
          actorId,
        },
        include: {
          supply: {
            include: {
              provider: true,
            },
          },
          actor: true,
        },
      });

      return transaction;
    });

    this.awardWarehouseTxPoints(actorId);
    return this.toTxView(tx);
  }

  // Gamificación hook
  private awardWarehouseTxPoints(actorId: string): void {
    void this.gamification.awardPoints(actorId, 'WAREHOUSE_TX');
  }

  async importSupplies(actorId: string, dto: ImportSuppliesDto): Promise<{ count: number }> {
    let count = 0;
    await this.prisma.$transaction(async (prismaTx) => {
      for (const item of dto.items) {
        // Upsert supply
        const supply = await prismaTx.supply.upsert({
          where: { code: item.code },
          create: {
            code: item.code,
            name: item.name,
            description: item.description || null,
            category: item.category || null,
            unit: item.unit || 'unidades',
            providerId: item.providerId || null,
          },
          update: {
            name: item.name,
            description: item.description || null,
            category: item.category || null,
            unit: item.unit || 'unidades',
            providerId: item.providerId || null,
          },
        });

        // If initial stock and warehouse are specified, register ENTRY
        if (item.initialStock && item.initialStock > 0 && item.warehouseId) {
          const warehouse = await prismaTx.warehouse.findUnique({
            where: { id: item.warehouseId },
          });
          if (warehouse) {
            const currentStock = await prismaTx.warehouseStock.findUnique({
              where: {
                warehouseId_supplyId: {
                  warehouseId: item.warehouseId,
                  supplyId: supply.id,
                },
              },
            });

            const nextQty = (currentStock?.quantity || 0) + item.initialStock;

            await prismaTx.warehouseStock.upsert({
              where: {
                warehouseId_supplyId: {
                  warehouseId: item.warehouseId,
                  supplyId: supply.id,
                },
              },
              create: {
                warehouseId: item.warehouseId,
                supplyId: supply.id,
                quantity: nextQty,
              },
              update: {
                quantity: nextQty,
              },
            });

            await prismaTx.warehouseTransaction.create({
              data: {
                warehouseId: item.warehouseId,
                supplyId: supply.id,
                type: 'ENTRY',
                quantity: item.initialStock,
                reason: 'Carga inicial masiva (Import Wizard)',
                actorId,
              },
            });
          }
        }
        count++;
      }
    });

    return { count };
  }

  private toWarehouseView(w: Warehouse): WarehouseView {
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      location: w.location,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  }

  private toSupplyView(s: Supply & { provider?: Provider | null }): SupplyView {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      description: s.description,
      category: s.category,
      unit: s.unit,
      providerId: s.providerId,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      provider: s.provider
        ? {
            id: s.provider.id,
            name: s.provider.name,
          }
        : null,
    };
  }

  private toTxView(
    t: WarehouseTransaction & { supply: Supply & { provider?: Provider | null }; actor?: User | null },
  ): WarehouseTransactionView {
    return {
      id: t.id,
      warehouseId: t.warehouseId,
      supplyId: t.supplyId,
      type: t.type,
      quantity: t.quantity,
      reason: t.reason,
      actorId: t.actorId,
      createdAt: t.createdAt.toISOString(),
      supply: this.toSupplyView(t.supply),
      actor: t.actor
        ? {
            firstName: t.actor.firstName,
            lastName: t.actor.lastName,
          }
        : null,
    };
  }
}
