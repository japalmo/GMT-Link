-- Feature "verificación de correo/contraseña" — migración ADITIVA y retrocompatible.
-- Solo CREATE TYPE / ADD COLUMN (nullable o con @default) / CREATE INDEX. Cero DROP,
-- cero NOT NULL nuevo sobre filas existentes. Retrocompatible: web y api comparten la
-- misma BD; estas columnas no rompen filas ni flujos existentes. En particular, el
-- default de "otp_codes"."purpose" preserva el no-repudio de cubicaciones (métricas)
-- para filas ya creadas y para el endpoint metrics/otp/*.

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('INSTITUCIONAL', 'PERSONAL');

-- AlterTable: verificación + cambio de correo pendiente (aditivo, todo nullable)
ALTER TABLE "User" ADD COLUMN     "emailInstitucionalVerified" TIMESTAMP(3),
ADD COLUMN     "emailPersonalVerified" TIMESTAMP(3),
ADD COLUMN     "pendingEmail" TEXT,
ADD COLUMN     "pendingEmailKind" "EmailKind";

-- AlterTable: propósito del OTP (default preserva el flujo de métricas)
ALTER TABLE "otp_codes" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'METRICS_NONREPUDIATION';

-- AlterTable: correo destino de notificaciones por email ('INSTITUCIONAL' | 'PERSONAL')
ALTER TABLE "user_preferences" ADD COLUMN     "notifyEmailTarget" TEXT;

-- CreateIndex: lookups de OTP por (email, purpose)
CREATE INDEX "otp_codes_email_purpose_idx" ON "otp_codes"("email", "purpose");
