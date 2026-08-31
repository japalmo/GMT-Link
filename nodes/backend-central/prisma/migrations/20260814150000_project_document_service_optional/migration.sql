-- El documento de proyecto cuelga del PROYECTO; el servicio es solo su
-- clasificación. Antes `serviceId` era obligatorio y con ON DELETE CASCADE, así
-- que borrar un servicio BORRABA sus documentos (pérdida real). Ahora es opcional
-- y con ON DELETE SET NULL: borrar un servicio solo DESVINCULA sus documentos
-- (siguen en el proyecto).
--
-- Migración segura: relaja el NOT NULL (no toca valores existentes) y cambia el
-- comportamiento de la FK. Hoy no hay documentos con serviceId NULL.

ALTER TABLE "project_documents" ALTER COLUMN "serviceId" DROP NOT NULL;

ALTER TABLE "project_documents" DROP CONSTRAINT "project_documents_serviceId_fkey";

ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
