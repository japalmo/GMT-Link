import type { ReactNode } from 'react';
import { Truck } from 'lucide-react';
import { WidgetShell } from './widget-shell';

/**
 * Widget "Flota" (§6-2.1). Aún no tiene endpoint de datos (la flota llega en una
 * etapa posterior del roadmap), así que muestra un estado "Próximamente"
 * coherente con el resto del dashboard en vez de un dato falso.
 */
export function FlotaResumenWidget(): ReactNode {
  return (
    <WidgetShell title="Flota" description="Resumen de vehículos" icon={Truck}>
      <div className="flex flex-col items-start gap-2">
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Próximamente
        </span>
        <p className="text-sm text-muted-foreground">
          El resumen de la flota estará disponible cuando se habilite el módulo de
          recursos.
        </p>
      </div>
    </WidgetShell>
  );
}
