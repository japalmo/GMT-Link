-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('EQUIPO', 'VEHICULO');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('DISPONIBLE', 'EN_USO', 'MANTENIMIENTO', 'BAJA');

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "projectId" TEXT,
    "assignedToId" TEXT,
    "inUseById" TEXT,
    "inUseSince" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'EN_REVISION',
    "previousFileUrl" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_history" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

-- CreateIndex
CREATE INDEX "assets_type_status_idx" ON "assets"("type", "status");

-- CreateIndex
CREATE INDEX "asset_documents_assetId_idx" ON "asset_documents"("assetId");

-- CreateIndex
CREATE INDEX "asset_history_assetId_createdAt_idx" ON "asset_history"("assetId", "createdAt");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_inUseById_fkey" FOREIGN KEY ("inUseById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
