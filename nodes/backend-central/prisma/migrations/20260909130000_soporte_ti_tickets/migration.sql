-- Soporte TI (PR-TI-01): canal formal de solicitudes al área de Informática.
-- Migración ADITIVA: crea tres tablas y ocho enums nuevos. No altera ni una
-- columna existente; lo único que toca de lo viejo son las claves foráneas que
-- salen de `tickets` hacia User/Department/Faena/Project, que no modifican esas
-- tablas. Por eso es segura de aplicar en producción sin ventana.

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "TicketType" AS ENUM ('REQUERIMIENTO', 'INCIDENCIA', 'MEJORA', 'ACCESO');

CREATE TYPE "TicketStatus" AS ENUM (
  'BORRADOR', 'ENVIADO', 'EN_TRIAGE', 'REQUIERE_INFO', 'RECHAZADO', 'EN_BACKLOG',
  'EN_LEVANTAMIENTO', 'EN_DISENO', 'EN_DESARROLLO', 'EN_QA', 'EN_UAT', 'ENTREGADO', 'CERRADO'
);

CREATE TYPE "TicketLane" AS ENUM ('PROYECTO', 'RAPIDA');

CREATE TYPE "TicketSize" AS ENUM ('S', 'M', 'L');

CREATE TYPE "TicketPriority" AS ENUM ('CRITICA', 'ALTA', 'NORMAL', 'BAJA');

CREATE TYPE "TicketPeopleAffected" AS ENUM ('RANGO_1_3', 'RANGO_4_10', 'RANGO_11_30', 'RANGO_31_MAS');

CREATE TYPE "TicketFrequency" AS ENUM ('DIARIA', 'SEMANAL', 'MENSUAL', 'PUNTUAL');

CREATE TYPE "TicketEventKind" AS ENUM ('STATUS', 'COMMENT');

-- ── tickets ──────────────────────────────────────────────────────────────────
CREATE TABLE "tickets" (
  "id"              TEXT NOT NULL,
  "ticketNumber"    TEXT NOT NULL,
  "type"            "TicketType" NOT NULL,
  "title"           TEXT NOT NULL,
  "status"          "TicketStatus" NOT NULL DEFAULT 'BORRADOR',
  "requesterId"     TEXT NOT NULL,
  "requesterName"   TEXT NOT NULL,
  "requesterEmail"  TEXT NOT NULL,
  "departmentId"    TEXT,
  "faenaId"         TEXT,
  "projectId"       TEXT,
  "managerName"     TEXT NOT NULL,
  "managerAck"      BOOLEAN NOT NULL DEFAULT false,
  "module"          TEXT NOT NULL,
  "expected"        TEXT NOT NULL,
  "impact"          TEXT NOT NULL,
  "peopleAffected"  "TicketPeopleAffected" NOT NULL,
  "frequency"       "TicketFrequency" NOT NULL,
  "dueDate"         TIMESTAMP(3),
  "milestone"       TEXT NOT NULL DEFAULT '',
  "attachmentUrls"  TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lane"            "TicketLane",
  "size"            "TicketSize",
  "priority"        "TicketPriority",
  "assignedToId"    TEXT,
  "rejectionReason" TEXT NOT NULL DEFAULT '',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt"     TIMESTAMP(3),
  "triagedAt"       TIMESTAMP(3),
  "closedAt"        TIMESTAMP(3),
  "lastEventAt"     TIMESTAMP(3),
  "slaTriageDueAt"  TIMESTAMP(3),

  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tickets_ticketNumber_key" ON "tickets"("ticketNumber");
CREATE INDEX "tickets_status_submittedAt_idx" ON "tickets"("status", "submittedAt");
CREATE INDEX "tickets_requesterId_createdAt_idx" ON "tickets"("requesterId", "createdAt");
CREATE INDEX "tickets_slaTriageDueAt_idx" ON "tickets"("slaTriageDueAt");

-- ── ticket_events (bitácora; nunca se edita ni se borra por separado) ────────
CREATE TABLE "ticket_events" (
  "id"       TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "byId"     TEXT NOT NULL,
  "byName"   TEXT NOT NULL,
  "kind"     "TicketEventKind" NOT NULL,
  "from"     "TicketStatus",
  "to"       "TicketStatus",
  "comment"  TEXT NOT NULL DEFAULT '',

  CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_events_ticketId_at_idx" ON "ticket_events"("ticketId", "at");

-- ── ticket_counters (correlativo anual TI-{año}-{4 dígitos}) ─────────────────
CREATE TABLE "ticket_counters" (
  "year" INTEGER NOT NULL,
  "seq"  INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "ticket_counters_pkey" PRIMARY KEY ("year")
);

-- ── Claves foráneas ──────────────────────────────────────────────────────────
-- Obligatorias en RESTRICT: no se borra un usuario que dejó tickets o bitácora.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Opcionales en SET NULL: borrar un departamento, faena o proyecto NO borra el
-- ticket (mismo criterio que los documentos de proyecto); solo lo desvincula.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_faenaId_fkey"
  FOREIGN KEY ("faenaId") REFERENCES "Faena"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- La bitácora muere con su ticket.
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_byId_fkey"
  FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
