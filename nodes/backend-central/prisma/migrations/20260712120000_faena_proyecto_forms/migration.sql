-- Correcciones de los formularios de Faena y Proyecto (aditiva/segura).
-- web + api comparten la MISMA BD de producción: no se borran columnas ni datos.

-- Faena: ubicación en el mapa (opcional).
ALTER TABLE "Faena" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "address" TEXT;

-- Project: fechas del proyecto (opcional).
ALTER TABLE "Project" ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "endDate" TIMESTAMP(3);

-- Project: departmentId deja de ser obligatorio (ya no se pide en la creación).
-- DROP NOT NULL preserva los valores existentes; no toca la FK ni los datos.
ALTER TABLE "Project" ALTER COLUMN "departmentId" DROP NOT NULL;

-- Project: la unicidad del código pasa de (departmentId, code) a (faenaId, code).
-- El code nuevo es `${faena.code}-${n}` (único por faena); las filas legacy con
-- faenaId NULL no colisionan (NULL es distinto en índices UNIQUE de Postgres).
DROP INDEX "Project_departmentId_code_key";
CREATE UNIQUE INDEX "Project_faenaId_code_key" ON "Project"("faenaId", "code");
