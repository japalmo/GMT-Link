import type { ComponentType, ReactNode } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { WidgetShell } from './widget-shell';
import { UsuariosTotalWidget } from './usuarios-total-widget';
import { DirectorioWidget } from './directorio-widget';
import { DocumentosPorVencerWidget } from './documentos-por-vencer-widget';
import { MiCvWidget } from './mi-cv-widget';
import { FlotaResumenWidget } from './flota-resumen-widget';
import { GamificationWidget } from './gamification-widget';

import { TareasResumenWidget } from './tareas-resumen-widget';
import { MapaActivosWidget } from './mapa-activos-widget';
import { AccountConfigProgressWidget } from './account-config-progress-widget';
import { MisTareasPendientesWidget } from './mis-tareas-pendientes-widget';
import { AccesosDirectosWidget } from './accesos-directos-widget';

/**
 * Mapa de `widgetKey` (catálogo del backend, §6-2.1) → componente que renderiza
 * ese widget trayendo su propio dato. Las claves deben coincidir con
 * `widgets.catalog.ts` del backend.
 */
const WIDGET_COMPONENTS: Readonly<Record<string, ComponentType>> = {
  'usuarios-total': UsuariosTotalWidget,
  directorio: DirectorioWidget,
  'mis-documentos-por-vencer': DocumentosPorVencerWidget,
  'mi-cv': MiCvWidget,
  'flota-resumen': FlotaResumenWidget,
  gamificacion: GamificationWidget,
  'tareas-resumen': TareasResumenWidget,
  'mapa-activos': MapaActivosWidget,
  'account-config-progress': AccountConfigProgressWidget,
  'mis-tareas-pendientes': MisTareasPendientesWidget,
  'accesos-directos': AccesosDirectosWidget,
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
