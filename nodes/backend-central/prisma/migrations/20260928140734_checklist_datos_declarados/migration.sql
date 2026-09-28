-- Renombre de `guest*` a `declared*`.
--
-- El DROP no pierde nada: esas columnas las crea la migracion inmediatamente
-- anterior, del MISMO despliegue, y todavia no hay codigo que las escriba.
--
-- El nombre `guest` estaba mal: no son solo del invitado sin cuenta. Quien
-- tiene sesion ve sus datos prellenados desde RRHH y puede corregirlos para un
-- checklist puntual, y esa correccion vive en estas mismas columnas. Lo que las
-- define es que las DECLARO la persona al firmar, no si tenia cuenta.

/*
  Warnings:

  - You are about to drop the column `guestEmail` on the `checklist_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `guestInternalExpiry` on the `checklist_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `guestLicenseClass` on the `checklist_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `guestLicenseExpiry` on the `checklist_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `guestName` on the `checklist_submissions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "checklist_submissions" DROP COLUMN "guestEmail",
DROP COLUMN "guestInternalExpiry",
DROP COLUMN "guestLicenseClass",
DROP COLUMN "guestLicenseExpiry",
DROP COLUMN "guestName",
ADD COLUMN     "declaredEmail" TEXT,
ADD COLUMN     "declaredInternalExpiry" TIMESTAMP(3),
ADD COLUMN     "declaredLicenseClass" TEXT,
ADD COLUMN     "declaredLicenseExpiry" TIMESTAMP(3),
ADD COLUMN     "declaredName" TEXT;
