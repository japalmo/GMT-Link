-- CreateEnum
CREATE TYPE "WarehouseTxType" AS ENUM ('ENTRY', 'EXIT');

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "rut" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_products" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_ratings" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unidades',
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_stocks" (
    "warehouseId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "warehouse_stocks_pkey" PRIMARY KEY ("warehouseId","supplyId")
);

-- CreateTable
CREATE TABLE "warehouse_transactions" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "type" "WarehouseTxType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gemini_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gemini_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "providers_rut_key" ON "providers"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "supplies_code_key" ON "supplies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- AddForeignKey
ALTER TABLE "provider_products" ADD CONSTRAINT "provider_products_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_ratings" ADD CONSTRAINT "provider_ratings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_ratings" ADD CONSTRAINT "provider_ratings_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transactions" ADD CONSTRAINT "warehouse_transactions_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transactions" ADD CONSTRAINT "warehouse_transactions_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transactions" ADD CONSTRAINT "warehouse_transactions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gemini_usage" ADD CONSTRAINT "gemini_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
