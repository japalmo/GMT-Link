-- Módulo Inventario. Aditiva: detalle descriptivo del artículo en supplies +
-- vínculo artículo-proveedor + solicitudes de insumos + entregas (asignaciones).

-- AlterTable
ALTER TABLE "supplies" ADD COLUMN "brand" TEXT,
ADD COLUMN "color" TEXT,
ADD COLUMN "size" TEXT,
ADD COLUMN "model" TEXT;

-- CreateEnum
CREATE TYPE "SupplyRequestStatus" AS ENUM ('PENDIENTE', 'ENTREGADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "supply_providers" (
    "id" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "price" INTEGER,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SupplyRequestStatus" NOT NULL DEFAULT 'PENDIENTE',
    "note" TEXT,
    "rejectionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_request_items" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "supply_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_assignments" (
    "id" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "warehouseId" TEXT,
    "deliveredById" TEXT,
    "requestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supply_providers_supplyId_providerId_key" ON "supply_providers"("supplyId", "providerId");

-- CreateIndex (Postgres no indexa FKs automáticamente)
CREATE INDEX "supply_providers_providerId_idx" ON "supply_providers"("providerId");

-- CreateIndex
CREATE INDEX "supply_request_items_requestId_idx" ON "supply_request_items"("requestId");

-- CreateIndex
CREATE INDEX "supply_request_items_supplyId_idx" ON "supply_request_items"("supplyId");

-- CreateIndex
CREATE INDEX "supply_requests_userId_status_idx" ON "supply_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "supply_requests_status_idx" ON "supply_requests"("status");

-- CreateIndex
CREATE INDEX "supply_assignments_userId_idx" ON "supply_assignments"("userId");

-- CreateIndex
CREATE INDEX "supply_assignments_supplyId_idx" ON "supply_assignments"("supplyId");

-- AddForeignKey
ALTER TABLE "supply_providers" ADD CONSTRAINT "supply_providers_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_providers" ADD CONSTRAINT "supply_providers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_request_items" ADD CONSTRAINT "supply_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_request_items" ADD CONSTRAINT "supply_request_items_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_assignments" ADD CONSTRAINT "supply_assignments_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_assignments" ADD CONSTRAINT "supply_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_assignments" ADD CONSTRAINT "supply_assignments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_assignments" ADD CONSTRAINT "supply_assignments_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
