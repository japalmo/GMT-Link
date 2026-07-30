-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('RUTINARIA', 'DEMANDA', 'SPOT');
CREATE TYPE "TaskPriority" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'URGENTE');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "parentId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "type" "TaskType" NOT NULL DEFAULT 'SPOT';
ALTER TABLE "tasks" ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'BAJA';
ALTER TABLE "tasks" ADD COLUMN "priorityManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "startDate" TIMESTAMP(3);

-- Make projectId nullable
ALTER TABLE "tasks" ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_parentId_idx" ON "tasks"("parentId");
CREATE INDEX "tasks_priority_dueDate_idx" ON "tasks"("priority", "dueDate");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
