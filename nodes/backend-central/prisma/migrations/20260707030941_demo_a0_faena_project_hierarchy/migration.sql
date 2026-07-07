-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('SPOT', 'OBRAS_CIVILES', 'RUTINARIO');

-- CreateEnum
CREATE TYPE "FaenaStatus" AS ENUM ('PLANIFICADA', 'EN_PROGRESO', 'COMPLETADA');

-- CreateEnum
CREATE TYPE "ProjectWorkerStatus" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "ServiceFrequency" AS ENUM ('DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL', 'A_DEMANDA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VariableType" ADD VALUE 'ENTERO';
ALTER TYPE "VariableType" ADD VALUE 'DECIMAL';
ALTER TYPE "VariableType" ADD VALUE 'BOOLEAN';
ALTER TYPE "VariableType" ADD VALUE 'METROS';
ALTER TYPE "VariableType" ADD VALUE 'M3';
ALTER TYPE "VariableType" ADD VALUE 'TEXTO';
ALTER TYPE "VariableType" ADD VALUE 'IMAGEN';
ALTER TYPE "VariableType" ADD VALUE 'PLANO';
ALTER TYPE "VariableType" ADD VALUE 'POLIGONO';
ALTER TYPE "VariableType" ADD VALUE 'ORTOFOTO';
ALTER TYPE "VariableType" ADD VALUE 'PDF';
ALTER TYPE "VariableType" ADD VALUE 'GEODATA';
ALTER TYPE "VariableType" ADD VALUE 'OTRO';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "contractNumber" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "faenaId" TEXT,
ADD COLUMN     "projectAdminId" TEXT,
ADD COLUMN     "projectType" "ProjectType";

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "frequency" "ServiceFrequency";

-- AlterTable
ALTER TABLE "variables" ADD COLUMN     "description" TEXT,
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Faena" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "status" "FaenaStatus" NOT NULL DEFAULT 'PLANIFICADA',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faena_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWorkerAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "status" "ProjectWorkerStatus" NOT NULL DEFAULT 'ACTIVO',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectWorkerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Faena_clientId_code_key" ON "Faena"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWorkerAssignment_projectId_userId_roleKey_key" ON "ProjectWorkerAssignment"("projectId", "userId", "roleKey");

-- AddForeignKey
ALTER TABLE "Faena" ADD CONSTRAINT "Faena_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faena" ADD CONSTRAINT "Faena_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_faenaId_fkey" FOREIGN KEY ("faenaId") REFERENCES "Faena"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectAdminId_fkey" FOREIGN KEY ("projectAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWorkerAssignment" ADD CONSTRAINT "ProjectWorkerAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWorkerAssignment" ADD CONSTRAINT "ProjectWorkerAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
