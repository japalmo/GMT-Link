import type { ReactNode } from 'react';
import type { FinanceStatus } from '@/types/finance';
import { cn } from '@/lib/utils';

/** Etiqueta legible en español por estado de finanzas (reembolsos / horas extra). */
const STATUS_LABEL: Record<FinanceStatus, string> = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  PAGADO: 'Pagado',
  RECHAZADO: 'Rechazado',
};

/**
 * Chip de color para el estado de un reembolso u hora extra (§6-3.1 / §6-3.3):
 * - `PENDIENTE` → ámbar
 * - `APROBADO` → azul
 * - `PAGADO` → verde
 * - `RECHAZADO` → rojo (destructive)
 *
 * Usa tonos con variante dark, igual que `DocumentStatusBadge`.
 */
export function FinanceStatusBadge({ status }: { status: FinanceStatus }): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'PENDIENTE' &&
          'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
        status === 'APROBADO' &&
          'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
        status === 'PAGADO' &&
          'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
        status === 'RECHAZADO' &&
          'bg-destructive/10 text-destructive dark:bg-destructive/20',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Devuelve la etiqueta legible de un estado (para selects de filtro). */
export function financeStatusLabel(status: FinanceStatus): string {
  return STATUS_LABEL[status];
}
