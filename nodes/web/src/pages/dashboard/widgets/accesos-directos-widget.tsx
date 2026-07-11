import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Clock, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetShell } from './widget-shell';

/** Un acceso directo del widget: icono, etiqueta y ruta destino. */
interface Shortcut {
  label: string;
  icon: LucideIcon;
  to: string;
}

/**
 * Accesos directos del trabajador. "Registrar horas extra" navega a la pestaña
 * de horas de Finanzas (`/finanzas/horas`), que abre el flujo con su propio
 * `NewOvertimeDialog`; ese dialog es local a `finanzas/horas-extra.tsx` y no está
 * exportado, por eso se navega en lugar de reusar el componente directamente.
 */
const SHORTCUTS: readonly Shortcut[] = [
  { label: 'Registrar horas extra', icon: Clock, to: '/finanzas/horas' },
] as const;

/**
 * Widget "Accesos directos" (§6-2.1). Tarjeta con botones que llevan al
 * trabajador a las acciones de uso frecuente (por ahora, registrar horas extra).
 */
export function AccesosDirectosWidget(): ReactNode {
  const navigate = useNavigate();

  return (
    <WidgetShell
      title="Accesos directos"
      description="Registra tus horas extra a un clic"
      icon={Zap}
    >
      <div className="flex flex-col gap-2">
        {SHORTCUTS.map(({ label, icon: Icon, to }) => (
          <Button
            key={to}
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => navigate(to)}
          >
            <Icon className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{label}</span>
          </Button>
        ))}
      </div>
    </WidgetShell>
  );
}
