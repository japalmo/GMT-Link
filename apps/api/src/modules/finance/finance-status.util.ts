import { ConflictException } from '@nestjs/common';
import { FinanceStatus } from '@prisma/client';

/**
 * Transiciones de estado comunes a las solicitudes financieras (§6-3.1/3.3):
 * reembolsos y horas extra comparten exactamente la misma máquina de estados.
 *
 *   PENDIENTE ──approve──▶ APROBADO ──pay──▶ PAGADO
 *      └──────reject──────▶ RECHAZADO
 *
 * Cualquier transición desde un estado terminal (RECHAZADO/PAGADO) o que no
 * respete el orden (p. ej. pagar algo PENDIENTE) es inválida → 409 (Conflict).
 */
export type FinanceTransition = 'approve' | 'reject' | 'pay';

/** Estado destino de cada transición. */
const TARGET: Readonly<Record<FinanceTransition, FinanceStatus>> = {
  approve: FinanceStatus.APROBADO,
  reject: FinanceStatus.RECHAZADO,
  pay: FinanceStatus.PAGADO,
};

/** Estados desde los que cada transición es válida. */
const ALLOWED_FROM: Readonly<Record<FinanceTransition, ReadonlySet<FinanceStatus>>> = {
  approve: new Set([FinanceStatus.PENDIENTE]),
  reject: new Set([FinanceStatus.PENDIENTE]),
  pay: new Set([FinanceStatus.APROBADO]),
};

/**
 * Valida la transición y devuelve el estado destino. Lanza `ConflictException`
 * (409) si el estado actual no admite la transición pedida (estado inválido).
 */
export function nextFinanceStatus(
  current: FinanceStatus,
  transition: FinanceTransition,
): FinanceStatus {
  if (!ALLOWED_FROM[transition].has(current)) {
    throw new ConflictException(
      `No se puede ${transition} una solicitud en estado ${current}.`,
    );
  }
  return TARGET[transition];
}
