-- Subtipo de vehículo y tipo de identificador (patente o número de serie).
CREATE TYPE "VehicleSubtype" AS ENUM ('PICKUP', 'FURGON', 'AUTO', 'AUTOBUS', 'CAMION');
CREATE TYPE "AssetIdentifierType" AS ENUM ('PATENTE', 'NUMERO_SERIE');

-- Campos de identificación de primera clase.
ALTER TABLE "assets" ADD COLUMN "manufacturer" TEXT;
ALTER TABLE "assets" ADD COLUMN "identifier" TEXT;
ALTER TABLE "assets" ADD COLUMN "identifierType" "AssetIdentifierType";
ALTER TABLE "assets" ADD COLUMN "vehicleSubtype" "VehicleSubtype";

-- Backfill: la patente de los vehículos existentes vivía en metadata.plateCode.
UPDATE "assets"
SET "identifier" = "metadata"->>'plateCode', "identifierType" = 'PATENTE'
WHERE "type" = 'VEHICULO' AND "metadata"->>'plateCode' IS NOT NULL;
