-- Ciclo de uso de activos (modelo + estado intermedio). Aditiva.

-- CreateEnum
CREATE TYPE "UsageCycleStatus" AS ENUM ('EN_PREPARACION', 'EN_CURSO', 'CERRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "UsageEndKind" AS ENUM ('GPS', 'ESTACIONAMIENTO', 'TRASPASO');

-- AlterEnum: nuevo estado intermedio del activo (reservado mientras se llena el
-- checklist inicial del ciclo de uso). No se usa dentro de esta migracion, asi que
-- el ADD VALUE es seguro dentro de la transaccion (Postgres 12+).
ALTER TYPE "AssetStatus" ADD VALUE 'EN_PREPARACION';

-- CreateTable
CREATE TABLE "usage_cycles" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "UsageCycleStatus" NOT NULL DEFAULT 'EN_PREPARACION',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "checklistSubmissionId" TEXT,
    "startPhotoUrl" TEXT,
    "startPhotoKey" TEXT,
    "endPhotoUrl" TEXT,
    "endPhotoKey" TEXT,
    "endKind" "UsageEndKind",
    "endLatitude" DOUBLE PRECISION,
    "endLongitude" DOUBLE PRECISION,
    "endText" TEXT,
    "handoffToUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_cycles_checklistSubmissionId_key" ON "usage_cycles"("checklistSubmissionId");

-- CreateIndex
CREATE INDEX "usage_cycles_assetId_startedAt_idx" ON "usage_cycles"("assetId", "startedAt");

-- CreateIndex
CREATE INDEX "usage_cycles_userId_status_idx" ON "usage_cycles"("userId", "status");

-- AddForeignKey
ALTER TABLE "usage_cycles" ADD CONSTRAINT "usage_cycles_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_cycles" ADD CONSTRAINT "usage_cycles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_cycles" ADD CONSTRAINT "usage_cycles_checklistSubmissionId_fkey" FOREIGN KEY ("checklistSubmissionId") REFERENCES "checklist_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_cycles" ADD CONSTRAINT "usage_cycles_handoffToUserId_fkey" FOREIGN KEY ("handoffToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
