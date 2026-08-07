-- Avisos de vencimiento de documentos de activos.
--
-- Registro de qué aviso YA se envió, que es lo que da idempotencia al proceso.
-- Sin él, un barrido que corre cada hora mandaría el mismo aviso 24 veces al día
-- y la alerta se volvería ruido que la gente aprende a ignorar.
--
-- Migración ADITIVA: crea una tabla nueva y un índice. No toca datos existentes
-- ni cambia columnas, así que es segura de aplicar en caliente.

-- CreateTable
CREATE TABLE "asset_document_expiry_notices" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "enviadoApp" BOOLEAN NOT NULL DEFAULT false,
    "enviadoCorreo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_document_expiry_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_document_expiry_notices_documentId_idx"
    ON "asset_document_expiry_notices"("documentId");

-- CreateIndex: la deduplicación es POR PERSONA. Un admin de vehículos nuevo
-- recibe los hitos vigentes aunque otros ya los hayan recibido.
CREATE UNIQUE INDEX "asset_document_expiry_notices_documentId_userId_clave_key"
    ON "asset_document_expiry_notices"("documentId", "userId", "clave");

-- CreateIndex: el barrido busca documentos aprobados con fecha de vencimiento.
-- Sin este índice recorrería la tabla entera en cada corrida.
CREATE INDEX "asset_documents_status_expirationDate_idx"
    ON "asset_documents"("status", "expirationDate");

-- AddForeignKey
ALTER TABLE "asset_document_expiry_notices"
    ADD CONSTRAINT "asset_document_expiry_notices_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "asset_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_document_expiry_notices"
    ADD CONSTRAINT "asset_document_expiry_notices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
