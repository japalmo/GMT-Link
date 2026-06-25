import type { FinanceStatus } from '@prisma/client';

/**
 * Vista pública de una solicitud de horas extra (§6-3.3). Fechas en ISO-8601
 * (string) para el frontend. `hours` es decimal (Float). `requester` solo se
 * incluye en la vista del GESTOR (lista global / detalle de gestión).
 */
export interface OvertimeView {
  id: string;
  userId: string;
  /** ISO-8601 — fecha de las horas trabajadas. */
  date: string;
  hours: number;
  reason: string;
  status: FinanceStatus;
  decidedById: string | null;
  /** ISO-8601 cuando se resolvió; null si sigue pendiente. */
  decidedAt: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Datos del solicitante — solo en vistas de gestión. */
  requester?: OvertimeRequester;
}

/** Datos mínimos del solicitante para la lista del gestor (RoleScopedList). */
export interface OvertimeRequester {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
