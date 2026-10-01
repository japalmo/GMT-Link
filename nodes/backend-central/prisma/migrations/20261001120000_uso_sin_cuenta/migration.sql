-- Registrar uso SIN cuenta desde la ficha publica (QR) de un equipo.
--
-- El ciclo de uso deja de exigir usuario: quien no tiene cuenta declara su
-- nombre (y un comentario opcional), igual que el checklist sin cuenta. Los
-- ciclos existentes conservan su `userId`; no hay backfill.

-- AlterTable
ALTER TABLE "usage_cycles" ALTER COLUMN "userId" DROP NOT NULL,
ADD COLUMN     "declaredName" TEXT,
ADD COLUMN     "declaredComment" TEXT;
