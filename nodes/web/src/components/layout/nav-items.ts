import {
  LayoutDashboard,
  Users,
  Contact,
  Wallet,
  Boxes,
  Package,
  Wrench,
  Gauge,
  type LucideIcon,
} from 'lucide-react';

/** Ítem de navegación del sidebar. */
export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Clave de módulo para filtrar la visibilidad por cliente (ver GET /auth/me). */
  module: string;
  /** Marca placeholders aún no implementados (etapas posteriores). */
  placeholder?: boolean;
}

/**
 * Navegación primaria. Solo Dashboard está implementado; el resto son
 * placeholders coherentes con el roadmap (§6: Finanzas E3, Operaciones E4,
 * Recursos E5). Apuntan a rutas que muestran un estado "en construcción".
 */
export const PRIMARY_NAV: ReadonlyArray<NavItem> = [
  { label: 'Inicio', to: '/', icon: LayoutDashboard, module: 'dashboard' },
  { label: 'Usuarios', to: '/usuarios', icon: Users, module: 'usuarios' },
  { label: 'Directorio', to: '/directorio', icon: Contact, module: 'directorio' },
  { label: 'Finanzas', to: '/finanzas', icon: Wallet, module: 'finanzas' },
  { label: 'Operaciones', to: '/operaciones', icon: Boxes, module: 'operaciones' },
  { label: 'Recursos', to: '/recursos', icon: Package, module: 'recursos' },
];

/**
 * Navegación secundaria: herramientas técnicas (§6 E6) y el placeholder de
 * V-metric (§6-2.4).
 */
export const SECONDARY_NAV: ReadonlyArray<NavItem> = [
  { label: 'Herramientas', to: '/herramientas', icon: Wrench, module: 'herramientas' },
  { label: 'V-metric', to: '/v-metric', icon: Gauge, module: 'v-metric' },
];
