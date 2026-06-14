import {
  LayoutDashboard,
  Users,
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
  /** Marca placeholders aún no implementados (etapas posteriores). */
  placeholder?: boolean;
}

/**
 * Navegación primaria. Solo Dashboard está implementado; el resto son
 * placeholders coherentes con el roadmap (§6: Finanzas E3, Operaciones E4,
 * Recursos E5). Apuntan a rutas que muestran un estado "en construcción".
 */
export const PRIMARY_NAV: ReadonlyArray<NavItem> = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Usuarios', to: '/usuarios', icon: Users },
  { label: 'Finanzas', to: '/finanzas', icon: Wallet, placeholder: true },
  { label: 'Operaciones', to: '/operaciones', icon: Boxes, placeholder: true },
  { label: 'Recursos', to: '/recursos', icon: Package, placeholder: true },
];

/**
 * Navegación secundaria: herramientas técnicas (§6 E6) y el placeholder de
 * V-metric (§6-2.4).
 */
export const SECONDARY_NAV: ReadonlyArray<NavItem> = [
  { label: 'Herramientas', to: '/herramientas', icon: Wrench, placeholder: true },
  { label: 'V-metric', to: '/v-metric', icon: Gauge, placeholder: true },
];
