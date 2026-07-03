import {
  LayoutDashboard,
  Users,
  Contact,
  Wallet,
  Boxes,
  Package,
  Wrench,
  Gauge,
  ShieldCheck,
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
  /** Si es `true`, solo se muestra cuando `user.canManageRoles` es `true` (además del filtro de módulo). */
  requiresManageRoles?: boolean;
}

/**
 * Navegación primaria. Solo Dashboard está implementado; el resto son
 * placeholders coherentes con el roadmap (§6: Finanzas E3, Operaciones E4,
 * Recursos E5). Apuntan a rutas que muestran un estado "en construcción".
 */
export const PRIMARY_NAV: ReadonlyArray<NavItem> = [
  { label: 'Inicio', to: '/', icon: LayoutDashboard, module: 'dashboard' },
  { label: 'Usuarios', to: '/usuarios', icon: Users, module: 'usuarios' },
  { label: 'Roles', to: '/roles', icon: ShieldCheck, module: 'usuarios', requiresManageRoles: true },
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
