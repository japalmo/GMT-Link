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
 * El borrador de HE NO es un estado del enum: se modela con `isDraft` (spec §5,
 * resolución #3) y su badge "Borrador" se deriva de ahí, no de `status`.
 */
export type FinanceStatus = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'PAGADO';

/** Categorías de reembolso (spec §5.5). Backend acepta string libre; estas son
 * las etiquetas canónicas que usa el formulario nuevo. */
export type ReimbursementCategory =
  | 'ALIMENTACION'
  | 'TRANSPORTE'
  | 'VEHICULOS'
  | 'OTROS';

/** Subcategorías cuando la categoría es VEHICULOS (spec §5.5). */
export type VehicleSubcategory =
  | 'COMBUSTIBLE'
  | 'MANTENCION_LIMPIEZA'
  | 'REPUESTO'
  | 'OTRO';

/** Etiquetas legibles de categorías/subcategorías para selects y tablas. */
export const REIMBURSEMENT_CATEGORY_LABELS: Record<ReimbursementCategory, string> = {
  ALIMENTACION: 'Alimentación',
  TRANSPORTE: 'Transporte',
  VEHICULOS: 'Vehículos',
  OTROS: 'Otro(s)',
};

export const VEHICLE_SUBCATEGORY_LABELS: Record<VehicleSubcategory, string> = {
  COMBUSTIBLE: 'Combustible',
  MANTENCION_LIMPIEZA: 'Mantención / Limpieza',
  REPUESTO: 'Repuesto',
  OTRO: 'Otro',
};

/** Datos mínimos del solicitante para las vistas de gestión (RoleScopedList). */
export interface FinanceRequester {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Vista de un reembolso (espejo EXACTO de `ReimbursementView` del backend C1).
 * Nombres de vehículo/subcategoría alineados al backend (`vehicle`/`subcategory`,
 * resolución #4). Los reembolsos NO llevan proyecto/cliente.
 */
export interface ReimbursementView {
  id: string;
  userId: string;
  /** CLP entero (sin decimales). */
  amount: number;
  /** ISO-8601 — fecha del gasto. */
  date: string;
  concept: string;
  category: string | null;
  /** Solo Vehículos: Combustible | Mantención-Limpieza | Repuesto | Otro. */
  subcategory: string | null;
  /** id/etiqueta de vehículo cuando category = Vehículos. */
  vehicle: string | null;
  /** Observaciones opcionales del solicitante. */
  observations: string | null;
  /** URL de la boleta/comprobante; `null` mientras no se suba. */
  receiptUrl: string | null;
  /** Motivo persistido cuando status = RECHAZADO; `null` si no fue rechazado. */
  rejectionReason: string | null;
  /** Marcada como impresa en un lote (post-descarga). */
  printed: boolean;
  /** ISO-8601 cuando se marcó impresa; `null` si aún no. */
  printedAt: string | null;
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

/**
 * Vista de una solicitud de horas extra (espejo EXACTO de `OvertimeView` del
 * backend C1). El borrador se representa con `isDraft` (resolución #3), no con un
 * estado del enum. `hours`/`startTime`/`endTime`/`reason` pueden ser `null`.
 */
export interface OvertimeView {
  id: string;
  userId: string;
  /** ISO-8601 — fecha de las horas trabajadas. */
  date: string;
  /** Computada de inicio/término; `null` mientras la HE es borrador. */
  hours: number | null;
  /** Opcional: el formulario nuevo no lo exige (retrocompat). */
  reason: string | null;
  /** "HH:mm" hora de inicio; `null` en filas legacy. */
  startTime: string | null;
  /** "HH:mm" hora de término; `null` mientras es borrador. */
  endTime: string | null;
  /** Borrador (endTime ausente al crear): no aprobable hasta cerrarlo. El badge
   * "Borrador" se deriva de acá, NO del `status`. */
  isDraft: boolean;
  projectId: string | null;
  /** Texto libre cuando se elige "Otro" en proyecto. */
  projectOther: string | null;
  /** "Autorizado por" (admin_contrato / gerencias). */
  authorizedById: string | null;
  /** Quién la registró a nombre del dueño; `null` si la creó el propio trabajador. */
  onBehalfOfUserId: string | null;
  /** Motivo persistido cuando status = RECHAZADO; `null` si no fue rechazado. */
  rejectionReason: string | null;
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

/**
 * Cuerpo de `POST /reimbursements` (RequestForm §5). El `userId` lo deriva el
 * backend. `category`/`subcategory`/`vehicle`/`observations` alineados al DTO real.
 */
export interface CreateReimbursementInput {
  /** CLP entero positivo (> 0). */
  amount: number;
  /** ISO-8601. */
  date: string;
  /** 1..200 caracteres. */
  concept: string;
  /** Opcional, ≤ 80 caracteres. */
  category?: string;
  /** Solo Vehículos, ≤ 80 caracteres. */
  subcategory?: string;
  /** Solo Vehículos, ≤ 120 caracteres. */
  vehicle?: string;
  /** Observaciones opcionales, ≤ 1000 caracteres. */
  observations?: string;
}

/**
 * Cuerpo de `POST /overtime` (RequestForm §5). Espejo EXACTO del `CreateOvertimeDto`
 * del backend C1: el `userId` lo deriva el controller de la sesión; las horas se
 * COMPUTAN de `startTime`/`endTime` (no las envía el cliente). `endTime` ausente ⇒
 * borrador (`isDraft`). `projectId` y `projectOther` son excluyentes. `authorizedById`
 * y `onBehalfOfUserId` son opcionales (este último requiere permiso onbehalf).
 */
export interface CreateOvertimeInput {
  /** ISO-8601 — fecha de las horas. */
  date: string;
  /** "HH:mm" — obligatoria. */
  startTime: string;
  /** "HH:mm" — opcional: si falta, la solicitud queda borrador. */
  endTime?: string;
  /** Proyecto asignado; excluyente con `projectOther`. */
  projectId?: string;
  /** Texto libre cuando el proyecto es "Otro"; excluyente con `projectId`. */
  projectOther?: string;
  /** "Autorizado por" (admin_contrato / gerencias). */
  authorizedById?: string;
  /** Solo con permiso `finance:overtime:create:onbehalf`: crea a nombre de otro. */
  onBehalfOfUserId?: string;
  /** Motivo/descripción opcional (≤ 500 caracteres). */
  reason?: string;
}

/** Vista de una liquidación de sueldo (espejo del backend). Huérfana tras C2
 * (la subsección se quitó de la UI), pero el tipo se conserva para el hook/api. */
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

/* ─────────────────────────── Vista general (§5.2/§5.3) ─────────────────────── */

/** Referencia mínima de proyecto para hidratar nombre/cliente en la fila unificada.
 * Las HE del backend solo traen `projectId`; el nombre/cliente se resuelve contra
 * la lista de proyectos (client-side). */
export interface FinanceProjectRef {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
}

/** Tipo de solicitud en la fila unificada de la tabla histórica. */
export type FinanceRowKind = 'REEMBOLSO' | 'HORA_EXTRA';

/** Fila unificada (reembolso u HE) para la Vista general (§5.2/§5.3). */
export interface FinanceRow {
  id: string;
  kind: FinanceRowKind;
  /** ISO-8601 de la fecha del gasto / de las horas. */
  date: string;
  status: FinanceStatus;
  /** `true` solo para HE en borrador (badge "Borrador"). */
  isDraft: boolean;
  /** CLP entero (reembolso) o `null` (HE). */
  amount: number | null;
  /** Horas (HE) o `null` (reembolso / borrador). */
  hours: number | null;
  /** Concepto (reembolso) o motivo (HE). */
  description: string;
  category: string | null;
  requesterId: string;
  requesterName: string;
  /** Solo HE (los reembolsos no llevan proyecto — resolución #4). */
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Solo reembolsos: para el flujo de impresión en lote. */
  printed: boolean;
  receiptUrl: string | null;
}

/** Filtros de la tabla histórica (§5.3). `null` = sin filtro. El filtro por
 * proyecto/cliente aplica SOLO a HE (resolución #4). */
export interface OverviewFilters {
  requesterId: string | null;
  /** Modo de filtro por fecha. */
  dateMode: 'none' | 'before' | 'after' | 'between' | 'exact' | 'month';
  dateFrom: string | null;
  dateTo: string | null;
  /** "YYYY-MM" cuando dateMode === 'month' (cierre día 20). */
  month: string | null;
  projectId: string | null;
  clientId: string | null;
  order: 'asc' | 'desc';
}
