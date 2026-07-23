-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_departmentId_fkey";

-- AlterTable
ALTER TABLE "elements" ADD COLUMN     "areaId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "areaId" TEXT;

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "faenaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "areas_faenaId_name_key" ON "areas"("faenaId", "name");

-- CreateIndex
CREATE INDEX "elements_areaId_idx" ON "elements"("areaId");

-- CreateIndex
CREATE INDEX "tasks_areaId_idx" ON "tasks"("areaId");

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_faenaId_fkey" FOREIGN KEY ("faenaId") REFERENCES "Faena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guard: `tasks.elementId` era un soft-link sin FK. Antes de crear la
-- constraint se anulan las referencias colgantes (elementos ya borrados) para
-- que la migración no falle sobre datos existentes. Solo anula punteros rotos.
UPDATE "tasks" SET "elementId" = NULL
WHERE "elementId" IS NOT NULL
  AND "elementId" NOT IN (SELECT "id" FROM "elements");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "elements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
