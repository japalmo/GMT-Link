import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { formatCLP, formatHours } from '@/lib/format';
import { StatCarousel, type CarouselState } from './stat-carousel';
import { aggregate, rankByProject, rankByWorker, type RankEntry } from './finance-overview';
import type { FinanceRow } from '@/types/finance';

function StatCard({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}

function RankList({
  entries,
  unit,
}: {
  entries: RankEntry[];
  unit: 'clp' | 'hrs' | 'count';
}): ReactNode {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos.</p>;
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {entries.slice(0, 5).map((e) => (
        <li key={e.key} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{e.label}</span>
          <span className="tabular-nums font-medium">
            {unit === 'clp' ? formatCLP(e.value) : unit === 'hrs' ? formatHours(e.value) : e.value}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface OverviewCardsProps {
  /** Filas ya filtradas (las cards se recalculan del filtro — §5.2). */
  rows: FinanceRow[];
  /** Variante: `true` = acceso a todos (managers); `false` = trabajador. */
  hasAllAccess: boolean;
}

/**
 * Cards superiores de la Vista general (§5.2). Se recalculan a partir de `rows`
 * (ya filtradas por la tabla). Variante manager: métricas globales + rankings por
 * trabajador y por proyecto. Variante trabajador: sus métricas + carrusel por
 * proyecto (sólo proyectos con datos).
 */
export function OverviewCards({ rows, hasAllAccess }: OverviewCardsProps): ReactNode {
  const agg = aggregate(rows);

  const workerReimb = rankByWorker(rows, 'reimbursement');
  const workerOt = rankByWorker(rows, 'overtime');
  const projOt = rankByProject(rows, 'overtime');

  const byWorkerStates: CarouselState[] = [
    { title: 'Reembolso por trabajador', content: <RankList entries={workerReimb} unit="clp" /> },
    { title: 'Horas extra por trabajador', content: <RankList entries={workerOt} unit="hrs" /> },
  ];
  const byProjectStates: CarouselState[] = [
    { title: 'Horas extra por proyecto', content: <RankList entries={projOt} unit="hrs" /> },
    {
      title: 'Reembolsos pendientes / HE aprobadas',
      content: (
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Reembolsos pend. de aprobación</span>
            <span className="tabular-nums font-medium">{agg.reimbursementPendingCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Horas extra aprobadas</span>
            <span className="tabular-nums font-medium">{agg.overtimeApprovedCount}</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Horas extra pendientes" value={agg.overtimePendingCount} />
      <StatCard
        label="Reembolso pendiente de pago"
        value={formatCLP(agg.reimbursementApprovedUnpaid)}
      />

      {hasAllAccess ? (
        <>
          <StatCarousel states={byWorkerStates} />
          <StatCarousel states={byProjectStates} />
        </>
      ) : (
        <StatCarousel className="sm:col-span-2" states={byProjectStates} />
      )}
    </div>
  );
}
