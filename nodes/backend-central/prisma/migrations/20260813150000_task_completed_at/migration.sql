-- Momento en que una actividad (Task) pasó a COMPLETADO, para la curva de avance
-- real acumulado del Dashboard de producción.
--
-- Se setea al aprobar (pasar a COMPLETADO) y se limpia si la tarea se reabre.
-- Migración ADITIVA: columna nullable sin default. No toca datos existentes ni
-- reconstruye historia hacia atrás (las tareas ya completadas antes de esto
-- quedan con completedAt = NULL hasta que se re-aprueben).

ALTER TABLE "tasks" ADD COLUMN "completedAt" TIMESTAMP(3);
