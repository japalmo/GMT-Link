-- CreateEnum
CREATE TYPE "VmetricVarType" AS ENUM ('SCALAR', 'FILE', 'LIST');

-- CreateTable
CREATE TABLE "vmetric_elements" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "locationPolygon" TEXT,
    "metadata" JSONB,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vmetric_phases" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vmetric_variables" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "VmetricVarType" NOT NULL,
    "unit" TEXT,
    "phaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vmetric_data_points" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "fileUrl" TEXT,
    "variableId" TEXT NOT NULL,
    "elementId" TEXT,
    "phaseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_data_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vmetric_elements_code_key" ON "vmetric_elements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vmetric_phases_serviceId_code_key" ON "vmetric_phases"("serviceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "vmetric_variables_phaseId_code_key" ON "vmetric_variables"("phaseId", "code");

-- AddForeignKey
ALTER TABLE "vmetric_elements" ADD CONSTRAINT "vmetric_elements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vmetric_phases" ADD CONSTRAINT "vmetric_phases_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vmetric_variables" ADD CONSTRAINT "vmetric_variables_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "vmetric_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vmetric_data_points" ADD CONSTRAINT "vmetric_data_points_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "vmetric_variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vmetric_data_points" ADD CONSTRAINT "vmetric_data_points_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "vmetric_elements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vmetric_data_points" ADD CONSTRAINT "vmetric_data_points_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "vmetric_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vmetric_data_points" ADD CONSTRAINT "vmetric_data_points_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
