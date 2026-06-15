/**
 * Tipos del frontend para el Dashboard modular (§6-2.1). Reflejan el contrato
 * HTTP de la API (`/dashboard/me`). El DATO de cada widget lo calcula el
 * frontend reusando endpoints existentes; aquí solo viven el catálogo de
 * widgets disponibles (ya filtrados por permiso en el backend) y el layout
 * (orden + visibilidad) que el usuario acomoda y persiste.
 */

/** Widget disponible para el usuario (subconjunto del catálogo que puede ver). */
export interface AvailableWidget {
  key: string;
  title: string;
  description: string;
}

/** Ítem de layout del dashboard (orden + visibilidad de un widget). */
export interface DashboardLayoutItem {
  widgetKey: string;
  order: number;
  visible: boolean;
}

/** Respuesta de `GET /dashboard/me` y `PUT /dashboard/me`. */
export interface DashboardView {
  /** Widgets que el usuario puede ver (catálogo filtrado por permiso). */
  widgets: AvailableWidget[];
  /** Layout reconciliado contra los widgets disponibles (order 0..n-1). */
  layout: DashboardLayoutItem[];
}
