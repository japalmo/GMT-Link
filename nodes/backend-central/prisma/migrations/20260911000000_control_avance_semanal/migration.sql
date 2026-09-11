-- Control de avance por HH: el informe semanal que se le entrega al cliente.
ALTER TABLE "Project" ADD COLUMN "totalHh" DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN "cutoffDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "planAtCutoff" DOUBLE PRECISION;

CREATE TABLE "project_weeks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "closeDate" TIMESTAMP(3) NOT NULL,
    "hhPlan" DOUBLE PRECISION NOT NULL,
    "parPlan" DOUBLE PRECISION NOT NULL,
    "parReal" DOUBLE PRECISION,
    "acmPlan" DOUBLE PRECISION NOT NULL,
    "acmReal" DOUBLE PRECISION,

    CONSTRAINT "project_weeks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_weeks_projectId_code_key" ON "project_weeks"("projectId", "code");
CREATE INDEX "project_weeks_projectId_index_idx" ON "project_weeks"("projectId", "index");

ALTER TABLE "project_weeks" ADD CONSTRAINT "project_weeks_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_activities" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "hh" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "hhByWeek" DOUBLE PRECISION[],
    "realByWeek" DOUBLE PRECISION[],

    CONSTRAINT "project_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_activities_projectId_wbsId_key" ON "project_activities"("projectId", "wbsId");
CREATE INDEX "project_activities_projectId_idx" ON "project_activities"("projectId");

ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
