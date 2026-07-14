-- Jornada / turnos del trabajador (1:1 con User). Aditiva: nueva tabla + enums.

-- CreateEnum
CREATE TYPE "ShiftPattern" AS ENUM ('ADMINISTRATIVO', 'SIETE_POR_SIETE', 'CUATRO_POR_TRES', 'CATORCE_POR_CATORCE', 'PERSONALIZADO');

-- CreateEnum
CREATE TYPE "DayNight" AS ENUM ('DIA', 'NOCHE');

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftPattern" "ShiftPattern" NOT NULL DEFAULT 'ADMINISTRATIVO',
    "workDays" INTEGER,
    "restDays" INTEGER,
    "cycleStart" TIMESTAMP(3),
    "dayNight" "DayNight" NOT NULL DEFAULT 'DIA',
    "startTime" TEXT,
    "endTime" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_userId_key" ON "work_schedules"("userId");

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
