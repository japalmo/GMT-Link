-- Índices para las vistas de gestión de finanzas (reembolsos y horas extra):
-- filtran por status + rango de date y ORDENAN por date. Aditivo (CREATE INDEX):
-- no borra columnas ni datos y no toca los índices existentes.

-- CreateIndex
CREATE INDEX "reimbursements_status_date_idx" ON "reimbursements"("status", "date");

-- CreateIndex
CREATE INDEX "overtime_requests_status_date_idx" ON "overtime_requests"("status", "date");
