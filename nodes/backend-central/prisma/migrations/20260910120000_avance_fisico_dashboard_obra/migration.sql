-- Dashboard de avance de obra (Cierre Perimetral Mantos Blancos).
--
-- Aditiva. Agrega el avance FÍSICO por cantidad a las actividades, el registro
-- de avances en el tiempo (base de la curva S real) y el token del dashboard
-- público del proyecto.

-- ── Hitos del programa: duración 0, sin cantidad ─────────────────────────────
-- `ADD VALUE` no puede usarse en la MISMA transacción que lo crea; acá solo se
-- declara y se usa recién en migraciones/inserts posteriores.
ALTER TYPE "TaskType" ADD VALUE 'HITO';

-- ── Cantidad contractual de la actividad ─────────────────────────────────────
-- Nullable a propósito: las actividades que ya existen no tienen métrica física
-- y los hitos nunca la tienen.
ALTER TABLE "tasks" ADD COLUMN "quantityTotal" DOUBLE PRECISION,
                    ADD COLUMN "unit" TEXT;

-- ── Token del dashboard público ──────────────────────────────────────────────
-- En TRES pasos, igual que `assets.publicToken` (migración 20260713100000): el
-- `@default(uuid())` de Prisma es del CLIENTE, no de la base, así que un
-- `ADD COLUMN ... NOT NULL` directo fallaría sobre los proyectos existentes.
ALTER TABLE "Project" ADD COLUMN "publicToken" TEXT;

UPDATE "Project" SET "publicToken" = gen_random_uuid()::text WHERE "publicToken" IS NULL;

ALTER TABLE "Project" ALTER COLUMN "publicToken" SET NOT NULL;

CREATE UNIQUE INDEX "Project_publicToken_key" ON "Project"("publicToken");

-- ── Registro de avances ──────────────────────────────────────────────────────
-- Cada fila es lo ejecutado en UNA fecha (incremental). La cantidad ejecutada de
-- una actividad es la SUMA de sus filas: no se denormaliza para que no pueda
-- quedar desfasada, y de esta serie sale la curva real en el tiempo.
CREATE TABLE "task_progress" (
    "id"           TEXT NOT NULL,
    "taskId"       TEXT NOT NULL,
    "date"         TIMESTAMP(3) NOT NULL,
    "quantity"     DOUBLE PRECISION NOT NULL,
    "note"         TEXT NOT NULL DEFAULT '',
    "reportedById" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_progress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_progress_taskId_date_idx" ON "task_progress"("taskId", "date");

-- Borrar la actividad se lleva su historial de avance; borrar un usuario NO se
-- permite si dejó reportes (RESTRICT), para no perder la trazabilidad de quién
-- reportó qué.
ALTER TABLE "task_progress" ADD CONSTRAINT "task_progress_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_progress" ADD CONSTRAINT "task_progress_reportedById_fkey"
  FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
