/**
 * Widget disponible para el usuario (subconjunto del catálogo que PUEDE ver).
 * El `permission` interno del catálogo no se expone: si el widget llegó aquí, ya
 * está autorizado.
 */
export interface AvailableWidget {
  key: string;
  title: string;
  description: string;
}

/**
 * Ítem de layout del dashboard (persistido en `DashboardConfig.layout` JSONB).
 * El frontend lo acomoda (orden + visibilidad) y lo guarda con PUT.
 */
export interface LayoutItem {
  widgetKey: string;
  order: number;
  visible: boolean;
}

/** Respuesta de `GET /dashboard/me` y `PUT /dashboard/me`. */
export interface DashboardView {
  /** Widgets que el usuario puede ver (catálogo filtrado por permiso). */
  widgets: AvailableWidget[];
  /** Layout reconciliado contra los widgets disponibles. */
  layout: LayoutItem[];
}
