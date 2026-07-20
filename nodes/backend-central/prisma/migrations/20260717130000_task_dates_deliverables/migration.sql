-- #76: fechas de planificación de la tarea (revisión y entrega) + motivo de rechazo
-- en revisión (#77). Aditivo, columnas nullable → seguro para filas existentes.
ALTER TABLE "tasks" ADD COLUMN "reviewDate" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "rejectionReason" TEXT;

-- #77: link opcional del entregable (ProjectDocument) a la tarea que lo produjo.
-- ON DELETE SET NULL: si se borra la tarea, el documento de proyecto se conserva.
ALTER TABLE "project_documents" ADD COLUMN "taskId" TEXT;
CREATE INDEX "project_documents_taskId_idx" ON "project_documents"("taskId");
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
