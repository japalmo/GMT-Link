-- AlterTable: columnas nuevas como NULLABLE para poder backfilear filas existentes
ALTER TABLE "User" ADD COLUMN     "username" TEXT;
ALTER TABLE "User" ADD COLUMN     "emailInstitucional" TEXT;
ALTER TABLE "User" ADD COLUMN     "emailPersonal" TEXT;

-- Backfill: el email actual pasa a institucional (§4.1)
UPDATE "User" SET "emailInstitucional" = "email" WHERE "emailInstitucional" IS NULL;

-- Backfill: username = prefijo del email, deduplicado con sufijo numérico determinístico.
-- Dos emails con el mismo prefijo (p.ej. operador@capstone.cl / operador@albemarle.cl) → operador, operador1.
WITH ranked AS (
  SELECT
    "id",
    lower(split_part("email", '@', 1)) AS base,
    row_number() OVER (
      PARTITION BY lower(split_part("email", '@', 1))
      ORDER BY "createdAt", "id"
    ) AS rn
  FROM "User"
)
UPDATE "User" u
SET "username" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || (r.rn - 1)::text END
FROM ranked r
WHERE u."id" = r."id";

-- Ahora sí: NOT NULL + índices únicos
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_emailInstitucional_key" ON "User"("emailInstitucional");
