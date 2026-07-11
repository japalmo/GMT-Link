-- Fase 1c — Finanzas backend: migración ADITIVA y retrocompatible.
-- Solo ADD COLUMN (nullable o con @default) y relajación de NOT NULL sobre
-- hours/reason de horas extra. Cero DROP de columnas, cero NOT NULL nuevo sobre
-- filas existentes: no rompe `web` en producción (web y web-dev comparten api/BD).

-- AlterTable
ALTER TABLE "overtime_requests" ADD COLUMN     "authorizedById" TEXT,
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onBehalfOfUserId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "projectOther" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "startTime" TEXT,
ALTER COLUMN "hours" DROP NOT NULL,
ALTER COLUMN "reason" DROP NOT NULL;

-- AlterTable
ALTER TABLE "reimbursements" ADD COLUMN     "observations" TEXT,
ADD COLUMN     "printed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printedAt" TIMESTAMP(3),
ADD COLUMN     "receiptKey" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "subcategory" TEXT,
ADD COLUMN     "vehicle" TEXT;

-- AddForeignKey
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_onBehalfOfUserId_fkey" FOREIGN KEY ("onBehalfOfUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
