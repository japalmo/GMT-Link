import type { FinanceStatus } from '@prisma/client';

/**
 * Vista pública de un reembolso (§6-3.1). Fechas en ISO-8601 (string) para el
 * frontend. `amount` es CLP entero (sin decimales). `requester` solo se incluye
 * en la vista del GESTOR (lista global / detalle de gestión), nunca hace falta
 * en "mis reembolsos" (el dueño se conoce a sí mismo).
 */
export interface ReimbursementView {
  id: string;
  userId: string;
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
  /** URL de la boleta/comprobante; null mientras no se suba. */
  receiptUrl: string | null;
  /** Motivo persistido cuando status = RECHAZADO. */
  rejectionReason: string | null;
  /** Marcada como impresa en un lote (post-descarga). */
  printed: boolean;
  /** ISO-8601 cuando se marcó impresa; null si no. */
  printedAt: string | null;
  status: FinanceStatus;
  decidedById: string | null;
  /** ISO-8601 cuando se resolvió (aprobó/rechazó/pagó); null si sigue pendiente. */
  decidedAt: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
  /** Datos del solicitante — solo en vistas de gestión. */
  requester?: ReimbursementRequester;
}

/** Datos mínimos del solicitante para la lista del gestor (RoleScopedList). */
export interface ReimbursementRequester {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Resultado del OCR de boleta re-exportado para el controller. */
export type { ReceiptScanResult } from './receipt-ocr.util';
