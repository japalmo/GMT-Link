import type { FinanceStatus } from '@prisma/client';
import type { Paginated } from '@gmt-platform/contracts';

export type { Paginated };

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
  /** HORA EXTRA real (periodo fuera del turno); null mientras la HE es borrador. */
  hours: number | null;
  /** Horas totales del periodo trabajado; null en borrador o filas legacy. */
  totalHours: number | null;
  /** Tramo de turno normal (total menos hora extra); null si no computable. */
  regularHours: number | null;
  /** Turno usado ese día "HH:mm-HH:mm"; null si descanso / sin turno configurado. */
  shiftLabel: string | null;
  /** Fin de semana o feriado: no se descuenta turno; todo el periodo es hora extra. */
  weekendOrHoliday: boolean;
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

/** Una opción de filtro (id + etiqueta) para los desplegables de la tabla de Gestión. */
export interface FinanceFilterOption {
  id: string;
  name: string;
}

/**
 * Opciones de los filtros de la tabla de Gestión de HE. Se derivan de las
 * solicitudes existentes (solo trabajadores/proyectos/clientes que YA tienen HE),
 * accesibles a quien puede ver todo (`finance:request:view:all`), sin exigir el
 * permiso de administrar usuarios que un gestor de finanzas no tiene.
 */
export interface OvertimeFilterOptions {
  workers: FinanceFilterOption[];
  projects: FinanceFilterOption[];
  clients: FinanceFilterOption[];
}
