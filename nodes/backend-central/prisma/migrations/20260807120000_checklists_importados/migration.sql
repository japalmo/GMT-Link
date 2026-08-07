-- Checklists importados desde la planilla de AppScript.
--
-- Mientras dure la transición, la flota sigue llenando el checklist en el
-- formulario viejo, que descarga a una hoja de cálculo. GMT Link pasa a ser el
-- sistema principal y lee esa hoja para tener TODO en la base. La lectura es en
-- un solo sentido: nunca se escribe de vuelta en la planilla.
--
-- Dos cambios:
--
-- 1. `userId` pasa a ser OPCIONAL. Un checklist importado no tiene usuario de la
--    plataforma. Adivinar la persona cruzando el nombre escrito a mano sería
--    inventar autoría en un registro que se firma, así que se guarda sin usuario
--    y el nombre queda aparte, como dato informativo (decisión del dueño).
--
-- 2. Se agrega la procedencia: de dónde vino el registro y cuál era su id allá.
--    El índice único sobre (origen, id) es lo que hace que reimportar la planilla
--    no duplique nada: el importador vuelve a pasar por los mismos registros cada
--    vez que corre, y sin esto los 2.136 checklists se multiplicarían en cada
--    pasada.
--
-- Migración segura en caliente: relajar una columna a NULL no toca las filas
-- existentes (todas tienen userId), y las tres columnas nuevas nacen vacías. El
-- índice único ignora los NULL en Postgres, así que los checklists hechos en GMT
-- Link (sin procedencia externa) no compiten entre sí por él.

-- AlterTable: userId deja de ser obligatorio
ALTER TABLE "checklist_submissions" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable: procedencia del registro
ALTER TABLE "checklist_submissions" ADD COLUMN "externalSource" TEXT;
ALTER TABLE "checklist_submissions" ADD COLUMN "externalId" TEXT;
ALTER TABLE "checklist_submissions" ADD COLUMN "externalAuthor" TEXT;

-- CreateIndex: idempotencia de la importación
CREATE UNIQUE INDEX "checklist_submissions_externalSource_externalId_key"
  ON "checklist_submissions"("externalSource", "externalId");
