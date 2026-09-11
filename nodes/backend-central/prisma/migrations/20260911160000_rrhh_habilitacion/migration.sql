-- RRHH: acreditaciones, exámenes ocupacionales e inducciones.

CREATE TYPE "AccreditationStatus" AS ENUM ('EN_TRAMITE', 'VIGENTE', 'SUSPENDIDA', 'RECHAZADA');
CREATE TYPE "ExamResult" AS ENUM ('APTO', 'APTO_CON_RESTRICCIONES', 'NO_APTO', 'PENDIENTE');

CREATE TABLE "worker_accreditations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "faenaId" TEXT,
    "status" "AccreditationStatus" NOT NULL DEFAULT 'EN_TRAMITE',
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "fileUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_accreditations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "worker_accreditations_userId_idx" ON "worker_accreditations"("userId");
CREATE INDEX "worker_accreditations_clientId_faenaId_idx" ON "worker_accreditations"("clientId", "faenaId");
ALTER TABLE "worker_accreditations" ADD CONSTRAINT "worker_accreditations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_accreditations" ADD CONSTRAINT "worker_accreditations_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_accreditations" ADD CONSTRAINT "worker_accreditations_faenaId_fkey"
    FOREIGN KEY ("faenaId") REFERENCES "Faena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "medical_exams" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "center" TEXT,
    "result" "ExamResult",
    "fileUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_exams_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "medical_exams_userId_type_idx" ON "medical_exams"("userId", "type");
ALTER TABLE "medical_exams" ADD CONSTRAINT "medical_exams_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inductions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "fileUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inductions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inductions_userId_idx" ON "inductions"("userId");
CREATE INDEX "inductions_clientId_idx" ON "inductions"("clientId");
ALTER TABLE "inductions" ADD CONSTRAINT "inductions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inductions" ADD CONSTRAINT "inductions_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "induction_faenas" (
    "inductionId" TEXT NOT NULL,
    "faenaId" TEXT NOT NULL,

    CONSTRAINT "induction_faenas_pkey" PRIMARY KEY ("inductionId", "faenaId")
);
CREATE INDEX "induction_faenas_faenaId_idx" ON "induction_faenas"("faenaId");
ALTER TABLE "induction_faenas" ADD CONSTRAINT "induction_faenas_inductionId_fkey"
    FOREIGN KEY ("inductionId") REFERENCES "inductions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "induction_faenas" ADD CONSTRAINT "induction_faenas_faenaId_fkey"
    FOREIGN KEY ("faenaId") REFERENCES "Faena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
