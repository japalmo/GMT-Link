import { type ReactNode, useCallback, useEffect, useState, useRef } from 'react';
import { Truck } from 'lucide-react';
import { WidgetShell } from './widget-shell';
import { listAssets } from '@/lib/api';
import type { AssetView } from '@/types/assets';

/**
 * Widget "Flota" (§6-2.1). Muestra un resumen real del número de vehículos
 * activos y su distribución por estado, usando la API de activos con
 * filtro `type=VEHICULO`.
 */
export function FlotaResumenWidget(): ReactNode {
  const [vehicles, setVehicles] = useState<AssetView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listAssets({ type: 'VEHICULO' as AssetView['type'] });
      if (!mountedRef.current) return;
      setVehicles(all);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Error al cargar flota.');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = vehicles.length;
  const disponible = vehicles.filter((v) => v.status === 'DISPONIBLE').length;
  const enUso = vehicles.filter((v) => v.status === 'EN_USO').length;
  const mantenimiento = vehicles.filter((v) => v.status === 'MANTENIMIENTO').length;

  return (
    <WidgetShell
      title="Flota"
      description="Resumen de vehículos."
      icon={Truck}
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay vehículos registrados aún.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{total}</span>
            <span className="text-sm text-muted-foreground">vehículos</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusChip label="Disponible" count={disponible} className="bg-primary/10 text-primary" />
            <StatusChip label="En uso" count={enUso} className="bg-accent text-accent-foreground" />
            <StatusChip label="Mant." count={mantenimiento} className="bg-destructive/10 text-destructive" />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}

function StatusChip({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}): ReactNode {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {count} {label}
    </span>
  );
}
