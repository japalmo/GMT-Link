-- CreateTable
CREATE TABLE "vmetric_reservorios" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "demBlobPath" TEXT,
    "demUpdatedAt" TIMESTAMP(3),
    "demFilename" TEXT,
    "demUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_reservorios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vmetric_cubicaciones" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reservorioCodigo" TEXT,
    "cotaSal" DOUBLE PRECISION,
    "cotaAgua" DOUBLE PRECISION,
    "fraccionOcluida" DOUBLE PRECISION,
    "volSalM3" DOUBLE PRECISION,
    "volSalmueraLibreM3" DOUBLE PRECISION,
    "volSalmueraOcluidaM3" DOUBLE PRECISION,
    "volSalmueraTotalM3" DOUBLE PRECISION,
    "areaEspejoM2" DOUBLE PRECISION,
    "precisionCeldaM" DOUBLE PRECISION,
    "origen" TEXT,
    "versionModelo" TEXT,
    "demFilename" TEXT,
    "demIdLocal" DOUBLE PRECISION,
    "usuario" TEXT,
    "uid" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "sourceCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_cubicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vmetric_dems" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reservorioCodigo" TEXT,
    "archivo" TEXT,
    "r2Key" TEXT,
    "r2Url" TEXT,
    "demId" DOUBLE PRECISION,
    "drone" TEXT,
    "usuario" TEXT,
    "uid" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_dems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vmetric_cotas_referencia" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reservorio" TEXT,
    "nombreCota" TEXT,
    "valorCota" DOUBLE PRECISION,
    "operador" TEXT,
    "observacion" TEXT,
    "datetimeCota" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vmetric_cotas_referencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vmetric_reservorios_sourceId_key" ON "vmetric_reservorios"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "vmetric_cubicaciones_sourceId_key" ON "vmetric_cubicaciones"("sourceId");

-- CreateIndex
CREATE INDEX "vmetric_cubicaciones_reservorioCodigo_idx" ON "vmetric_cubicaciones"("reservorioCodigo");

-- CreateIndex
CREATE UNIQUE INDEX "vmetric_dems_sourceId_key" ON "vmetric_dems"("sourceId");

-- CreateIndex
CREATE INDEX "vmetric_dems_reservorioCodigo_idx" ON "vmetric_dems"("reservorioCodigo");

-- CreateIndex
CREATE UNIQUE INDEX "vmetric_cotas_referencia_sourceId_key" ON "vmetric_cotas_referencia"("sourceId");

-- CreateIndex
CREATE INDEX "vmetric_cotas_referencia_reservorio_idx" ON "vmetric_cotas_referencia"("reservorio");
