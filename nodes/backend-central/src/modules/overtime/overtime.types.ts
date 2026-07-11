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
  /** Computada de inicio/término; null mientras la HE es borrador (endTime ausente). */
  hours: number | null;
  /** Opcional: el nuevo formulario no lo pide (se conserva por retrocompat). */
  reason: string | null;
  /** "HH:mm" hora de inicio; null en filas legacy. */
  startTime: string | null;
  /** "HH:mm" hora de término; null mientras es borrador. */
  endTime: string | null;
  /** Borrador (endTime ausente al crear): no es aprobable hasta cerrarlo. */
  isDraft: boolean;
  projectId: string | null;
  /** Texto libre cuando se elige "Otro" en proyecto. */
  projectOther: string | null;
  /** "Autorizado por" (admin_contrato / gerencias). */
  authorizedById: string | null;
  /** Quién la registró a nombre del dueño; null si la creó el propio trabajador. */
  onBehalfOfUserId: string | null;
  /** Motivo persistido cuando status = RECHAZADO. */
  rejectionReason: string | null;
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
