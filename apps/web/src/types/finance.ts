/**
 * Tipos del frontend para el módulo Finanzas (§6-3.1 Reembolsos / §6-3.3 Horas
 * extra). Reflejan los contratos HTTP de la API (`/reimbursements`,
 * `/overtime`). Las fechas viajan como ISO-8601 (string); `amount` es CLP entero
 * (sin decimales) y `hours` es decimal (Float). `requester` solo viene en las
 * vistas de GESTIÓN (lista global / detalle de gestión), nunca en "lo mío".
 */

/**
 * Máquina de estados compartida por reembolsos y horas extra:
 * `PENDIENTE` → (approve) `APROBADO` → (pay) `PAGADO`;
 * `PENDIENTE` → (reject) `RECHAZADO`. Los estados terminales no tienen acciones.
 */
export type FinanceStatus = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'PAGADO';

/** Datos mínimos del solicitante para las vistas de gestión (RoleScopedList). */
export interface FinanceRequester {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Vista de un reembolso (espejo de `ReimbursementView` del backend). */
export interface ReimbursementView {
  id: string;
  userId: string;
  /** CLP entero (sin decimales). */
  amount: number;
  /** ISO-8601 — fecha del gasto. */
  date: string;
  concept: string;
  category: string | null;
  /** URL de la boleta/comprobante; `null` mientras no se suba. */
  receiptUrl: string | null;
  status: FinanceStatus;
  decidedById: string | null;
  /** ISO-8601 cuando se resolvió (aprobó/rechazó/pagó); `null` si sigue pendiente. */
  decidedAt: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Datos del solicitante — solo en vistas de gestión. */
  requester?: FinanceRequester;
}

/** Vista de una solicitud de horas extra (espejo de `OvertimeView` del backend). */
export interface OvertimeView {
  id: string;
  userId: string;
  /** ISO-8601 — fecha de las horas trabajadas. */
  date: string;
  /** Decimal (Float). */
  hours: number;
  reason: string;
  status: FinanceStatus;
  decidedById: string | null;
  /** ISO-8601 cuando se resolvió; `null` si sigue pendiente. */
  decidedAt: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Datos del solicitante — solo en vistas de gestión. */
  requester?: FinanceRequester;
}

/** Cuerpo de `POST /reimbursements` (RequestForm §5). El `userId` lo deriva el backend. */
export interface CreateReimbursementInput {
  /** CLP entero positivo (> 0). */
  amount: number;
  /** ISO-8601. */
  date: string;
  /** 1..200 caracteres. */
  concept: string;
  /** Opcional, ≤ 80 caracteres. */
  category?: string;
}

/** Cuerpo de `POST /overtime` (RequestForm §5). El `userId` lo deriva el backend. */
export interface CreateOvertimeInput {
  /** ISO-8601. */
  date: string;
  /** Decimal (Float). */
  hours: number;
  reason: string;
}

/** Vista de una liquidación de sueldo (espejo del backend). */
export interface LiquidationView {
  id: string;
  userId: string;
  /** Mes en formato YYYY-MM. */
  period: string;
  fileUrl: string;
  uploadedById: string | null;
  createdAt: string;
  user?: FinanceRequester;
}

