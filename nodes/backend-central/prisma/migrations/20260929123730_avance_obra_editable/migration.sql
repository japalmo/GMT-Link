-- AlterTable
ALTER TABLE "project_weeks" ADD COLUMN     "acmRealOverride" DOUBLE PRECISION,
ADD COLUMN     "parRealOverride" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "photoKey" TEXT;
