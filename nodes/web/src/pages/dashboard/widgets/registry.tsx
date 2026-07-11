import type { ComponentType, ReactNode } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { WidgetShell } from './widget-shell';
import { UsuariosTotalWidget } from './usuarios-total-widget';
import { MiCvWidget } from './mi-cv-widget';
import { GamificationWidget } from './gamification-widget';
import { AccountConfigProgressWidget } from './account-config-progress-widget';
import { AccesosDirectosWidget } from './accesos-directos-widget';
import { MisSolicitudesRecientesWidget } from './mis-solicitudes-recientes-widget';

/**
 * Mapa de `widgetKey` (catálogo del backend, §6-2.1) → componente que renderiza
 * ese widget trayendo su propio dato. Las claves deben coincidir con
 * `widgets.catalog.ts` del backend.
 */
const WIDGET_COMPONENTS: Readonly<Record<string, ComponentType>> = {
  'usuarios-total': UsuariosTotalWidget,
  'mi-cv': MiCvWidget,
  gamificacion: GamificationWidget,
  'account-config-progress': AccountConfigProgressWidget,
  'accesos-directos': AccesosDirectosWidget,
  'mis-solicitudes-recientes': MisSolicitudesRecientesWidget,
};

/**
 * Renderiza el widget correspondiente a `widgetKey`. Si la clave no está en el
 * mapa (un widget nuevo en el backend que el front aún no implementa), muestra
 * un placeholder en lugar de romper el dashboard. Recibe el `title`/descripción
 * del catálogo del backend para que el placeholder sea informativo.
 */
export function renderWidget(
  widgetKey: string,
  fallbackTitle: string,
  fallbackDescription: string,
): ReactNode {
  const Component = WIDGET_COMPONENTS[widgetKey];
  if (Component) {
    return <Component />;
  }
  return (
    <WidgetShell
      title={fallbackTitle}
      description={fallbackDescription}
      icon={LayoutDashboard}
    >
      <p className="text-sm text-muted-foreground">
        Este widget aún no está disponible en esta versión.
      </p>
    </WidgetShell>
  );
}
