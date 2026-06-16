import { WarehouseTxType } from '@prisma/client';

export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplyView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
  provider?: { id: string; name: string } | null;
}

export interface WarehouseStockView {
  warehouseId: string;
  supplyId: string;
  quantity: number;
  supply?: SupplyView;
}

export interface WarehouseTransactionView {
  id: string;
  warehouseId: string;
  supplyId: string;
  type: WarehouseTxType;
  quantity: number;
  reason: string | null;
  actorId: string | null;
  createdAt: string;
  supply?: SupplyView;
  actor?: { firstName: string; lastName: string } | null;
}
