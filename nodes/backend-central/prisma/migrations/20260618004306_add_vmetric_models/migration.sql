-- CreateEnum
CREATE TYPE "VariableType" AS ENUM ('SCALAR', 'FILE', 'LIST');

-- CreateTable
CREATE TABLE "elements" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "locationPolygon" TEXT,
    "metadata" JSONB,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phases" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variables" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "VariableType" NOT NULL,
    "unit" TEXT,
    "phaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_points" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "fileUrl" TEXT,
    "variableId" TEXT NOT NULL,
    "elementId" TEXT,
    "phaseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "elements_code_key" ON "elements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "phases_serviceId_code_key" ON "phases"("serviceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "variables_phaseId_code_key" ON "variables"("phaseId", "code");

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phases" ADD CONSTRAINT "phases_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variables" ADD CONSTRAINT "variables_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_points" ADD CONSTRAINT "data_points_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_points" ADD CONSTRAINT "data_points_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "elements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_points" ADD CONSTRAINT "data_points_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_points" ADD CONSTRAINT "data_points_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
