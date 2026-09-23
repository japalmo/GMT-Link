-- HSE: reportes de incidente y sus fotos.
CREATE TABLE "hse_incidents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "empresa" TEXT NOT NULL DEFAULT 'GMT Ingenieria SPA',
    "sitio" TEXT,
    "area" TEXT,
    "turno" TEXT,
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "occurredAt" TEXT NOT NULL,
    "lesionPersonas" BOOLEAN NOT NULL DEFAULT false,
    "cargoLesionado" TEXT,
    "danoInfraestructura" BOOLEAN NOT NULL DEFAULT false,
    "danoDetalle" TEXT,
    "fugaDerrame" BOOLEAN NOT NULL DEFAULT false,
    "fugaSustancia" TEXT,
    "fugaDuracionMin" INTEGER,
    "fugaVolumenM3" DOUBLE PRECISION,
    "fugaPh" DOUBLE PRECISION,
    "fugaSuperficieM2" DOUBLE PRECISION,
    "emisionesAire" BOOLEAN NOT NULL DEFAULT false,
    "emisionGases" TEXT,
    "emisionDuracionMin" INTEGER,
    "instalaciones" BOOLEAN NOT NULL DEFAULT false,
    "instalacionesLugar" TEXT,
    "cuasiAccidente" BOOLEAN NOT NULL DEFAULT false,
    "procesoAfectado" BOOLEAN NOT NULL DEFAULT false,
    "tiempoPerdido" TEXT,
    "descripcion" TEXT NOT NULL,
    "accionesInmediatas" TEXT NOT NULL,
    "preparaNombre" TEXT NOT NULL,
    "preparaCargo" TEXT,
    "preparedOn" TIMESTAMP(3) NOT NULL,
    "pdfKey" TEXT,
    "pdfGeneratedAt" TIMESTAMP(3),
    "reporterEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hse_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hse_incident_photos" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hse_incident_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hse_incidents_code_key" ON "hse_incidents"("code");
CREATE UNIQUE INDEX "hse_incidents_publicToken_key" ON "hse_incidents"("publicToken");
CREATE INDEX "hse_incidents_occurredOn_idx" ON "hse_incidents"("occurredOn");
CREATE INDEX "hse_incident_photos_incidentId_position_idx" ON "hse_incident_photos"("incidentId", "position");

ALTER TABLE "hse_incident_photos" ADD CONSTRAINT "hse_incident_photos_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "hse_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
