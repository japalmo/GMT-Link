-- Trabajador de faena: ficha de persona sin acceso al sistema.
ALTER TABLE "User" ADD COLUMN "isFieldWorker" BOOLEAN NOT NULL DEFAULT false;

-- Cuadrilla asignada a una tarea.
CREATE TABLE "task_workers" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_workers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_workers_taskId_userId_key" ON "task_workers"("taskId", "userId");
CREATE INDEX "task_workers_userId_idx" ON "task_workers"("userId");

-- Un solo jefe por cuadrilla, garantizado por la base y no por el servicio:
-- dos peticiones simultáneas podrían dejar dos jefes si solo lo revisara el código.
CREATE UNIQUE INDEX "task_workers_un_jefe_por_tarea" ON "task_workers"("taskId") WHERE "lead";

ALTER TABLE "task_workers" ADD CONSTRAINT "task_workers_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_workers" ADD CONSTRAINT "task_workers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
