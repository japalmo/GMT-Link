-- "No vence" explícito: distingue un requisito perpetuo de uno sin fecha cargada.
ALTER TABLE "personal_documents" ADD COLUMN "noExpiry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "worker_accreditations" ADD COLUMN "noExpiry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "medical_exams" ADD COLUMN "noExpiry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inductions" ADD COLUMN "noExpiry" BOOLEAN NOT NULL DEFAULT false;
