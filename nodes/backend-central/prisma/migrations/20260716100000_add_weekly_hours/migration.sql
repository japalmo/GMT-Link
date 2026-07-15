-- Horario semanal por día para el patrón ADMINISTRATIVO. Aditiva: solo agrega la
-- columna JSONB "weeklyHours" (array de { weekday: 1..7 ISO, start: "HH:mm",
-- end: "HH:mm" }; solo los días trabajados aparecen). Las filas existentes quedan
-- en NULL y se interpretan como lunes a viernes con startTime/endTime legacy.

-- AlterTable
ALTER TABLE "work_schedules" ADD COLUMN "weeklyHours" JSONB;
