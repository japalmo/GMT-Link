import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCLP, formatDate } from '@/lib/format';
import { StatusBadge } from '@/components/ui/status-badge';
import { useReimbursements } from '@/hooks/use-reimbursements';
import { useOvertime } from '@/hooks/use-overtime';
import { toFinanceRows } from '@/pages/finanzas/finance-overview';
import { WidgetShell } from './widget-shell';

/** Máximo de solicitudes listadas en el widget para mantenerlo compacto. */
const MAX_ITEMS = 5;

/**
 * Widget "Mis solicitudes recientes" (§6-2.1). Visible para todos los roles: lista
 * de forma compacta las últimas solicitudes PROPIAS del usuario (reembolsos +
 * horas extra), unificadas con `toFinanceRows` y ordenadas por fecha desc. Reusa
 * los hooks de datos existentes (`useReimbursements`/`useOvertime`) tomando solo
 * `mine`; el probe de gestión de esos hooks es irrelevante aquí. Cada fila muestra
 * el tipo, un detalle corto, el monto (reembolso) u horas (HE), la fecha y el
 * estado (badge de finanzas, o "Borrador" para HE sin cerrar).
 */
export function MisSolicitudesRecientesWidget(): ReactNode {
  const reimb = useReimbursements();
  const ot = useOvertime();

  const loading = reimb.loading || ot.loading;
  const error = reimb.error ?? ot.error;

  // Solo "lo mío": los reembolsos no llevan proyecto y las HE no lo necesitan aquí.
  const rows = toFinanceRows(reimb.mine, ot.mine, [])
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ITEMS);

  const retry = (): void => {
    void reimb.refetch();
    void ot.refetch();
  };

  return (
    <WidgetShell
      title="Mis solicitudes recientes"
      description="Tus últimos reembolsos y horas extra"
      icon={Receipt}
      loading={loading}
      error={error}
      onRetry={retry}
    >
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-sm text-muted-foreground">Aún no tienes solicitudes.</p>
            <Link
              to="/finanzas"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Ir a Finanzas
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {rows.map((row) => (
                <li
                  key={`${row.kind}-${row.id}`}
                  className="flex flex-col gap-0.5 py-2 first:pt-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {row.kind === 'REEMBOLSO' ? 'Reembolso' : 'Horas extra'}
                    </span>
                    {row.kind === 'HORA_EXTRA' && row.isDraft ? (
                      <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Borrador
                      </span>
                    ) : (
                      <StatusBadge type="finance" status={row.status} />
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{row.description}</span>
                    <span className="shrink-0 font-medium text-foreground">
                      {row.kind === 'REEMBOLSO'
                        ? formatCLP(row.amount ?? 0)
                        : `${row.hours ?? 0} hrs`}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(row.date)}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              to="/finanzas"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'w-full',
              )}
            >
              Ver Finanzas
            </Link>
          </>
        )}
      </div>
    </WidgetShell>
  );
}
