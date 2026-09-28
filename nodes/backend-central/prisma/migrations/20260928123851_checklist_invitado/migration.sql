-- AlterTable
ALTER TABLE "checklist_submissions" ADD COLUMN     "guestEmail" TEXT,
ADD COLUMN     "guestInternalExpiry" TIMESTAMP(3),
ADD COLUMN     "guestLicenseClass" TEXT,
ADD COLUMN     "guestLicenseExpiry" TIMESTAMP(3),
ADD COLUMN     "guestName" TEXT;

-- AlterTable
ALTER TABLE "personal_documents" ALTER COLUMN "fileUrl" DROP NOT NULL;
