-- GAP3: token opaco no enumerable para la ficha pública / QR (el `code` correlativo
-- permitía raspar todo el parque). Backfill de los activos existentes con un UUID.
ALTER TABLE "assets" ADD COLUMN "publicToken" TEXT;

UPDATE "assets" SET "publicToken" = gen_random_uuid()::text WHERE "publicToken" IS NULL;

ALTER TABLE "assets" ALTER COLUMN "publicToken" SET NOT NULL;

CREATE UNIQUE INDEX "assets_publicToken_key" ON "assets"("publicToken");
