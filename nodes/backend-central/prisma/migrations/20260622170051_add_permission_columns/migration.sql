/*
  Warnings:

  - Added the required column `updatedAt` to the `Role` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'PROJECT', 'GLOBAL');

-- CreateEnum
CREATE TYPE "PermissionKind" AS ENUM ('FUNCTIONAL', 'STRUCTURAL');

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- AlterTable
ALTER TABLE "Permission" ADD COLUMN     "fgaRelation" TEXT,
ADD COLUMN     "kind" "PermissionKind" NOT NULL DEFAULT 'FUNCTIONAL',
ADD COLUMN     "module" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "scopeable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "RolePermission" ADD COLUMN     "scope" "PermissionScope" NOT NULL DEFAULT 'PROJECT';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
