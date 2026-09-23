-- Coordenadas del pin del mapa en el reporte de incidente.
ALTER TABLE "hse_incidents" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "hse_incidents" ADD COLUMN "longitude" DOUBLE PRECISION;
