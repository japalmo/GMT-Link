-- Desglose de horas extra contra el turno del trabajador. Aditiva.
--  - `hours` pasa a significar la HORA EXTRA real (periodo fuera del turno).
--  - `totalHours` guarda las horas totales del periodo trabajado.
--  - `shiftLabel` guarda el turno usado ese día ("HH:mm-HH:mm").

-- AlterTable
ALTER TABLE "overtime_requests" ADD COLUMN "totalHours" DOUBLE PRECISION;
ALTER TABLE "overtime_requests" ADD COLUMN "shiftLabel" TEXT;

-- Backfill de filas existentes: antes `hours` era el total, así que el total es ese
-- valor y (sin turno conocido) toda esa duración queda como hora extra. Al editar o
-- recalcular una fila se recompone el desglose real contra el turno del día.
UPDATE "overtime_requests" SET "totalHours" = "hours" WHERE "hours" IS NOT NULL;
