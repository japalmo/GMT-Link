-- AlterTable
ALTER TABLE "data_points" ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "dataSpec" JSONB,
ADD COLUMN     "elementId" TEXT,
ADD COLUMN     "phaseId" TEXT;

-- CreateTable
CREATE TABLE "task_time_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_time_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_time_logs_taskId_idx" ON "task_time_logs"("taskId");

-- CreateIndex
CREATE INDEX "task_time_logs_userId_idx" ON "task_time_logs"("userId");

-- AddForeignKey
ALTER TABLE "task_time_logs" ADD CONSTRAINT "task_time_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
