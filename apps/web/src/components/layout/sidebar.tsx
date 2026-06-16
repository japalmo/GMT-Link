import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  LogOut,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import { useSidebar } from '@/components/layout/use-sidebar';
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from '@/components/layout/nav-items';
import { NotificationBell } from '@/components/notifications/notification-bell';
import logoMid from '@/assets/branding/logo-mid.png';
import logoCompact from '@/assets/branding/logo-compact.png';

/** Iniciales para el avatar de fallback (nombre + apellido). */
function initials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return (a + b).toUpperCase() || '?';
}

function NavRow({
  item,
  collapsed,
  active,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      className={cn(
        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.placeholder && (
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Pronto
        </span>
      )}
    </NavLink>
  );
}

function IconAction({
  icon: Icon,
  label,
  onClick,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  collapsed: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size={collapsed ? 'icon' : 'sm'}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('text-muted-foreground', !collapsed && 'w-full justify-start gap-3')}
    >
      <Icon aria-hidden />
      {!collapsed && <span>{label}</span>}
    </Button>
  );
}

/**
 * Contenido del sidebar (compartido por la barra de escritorio y el drawer
 * móvil). `forceExpanded` ignora el colapso (el drawer móvil siempre va ancho).
 * `onNavigate` cierra el drawer al elegir una ruta.
 */
export function SidebarContent({
  forceExpanded = false,
  onNavigate,
}: {
  forceExpanded?: boolean;
  onNavigate?: () => void;
}) {
  const { user, logout } = useAuth();
  const { collapsed: collapsedState, toggleCollapsed } = useSidebar();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const collapsed = forceExpanded ? false : collapsedState;

  const isActive = (to: string): boolean =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

  const handleNavigate = onNavigate ?? (() => undefined);

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Marca + colapso */}
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b border-border px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        {collapsed ? (
          <img src={logoCompact} alt="GTM" className="h-8 w-auto object-contain" />
        ) : (
          <img src={logoMid} alt="GTM Link" className="h-8 w-auto object-contain" />
        )}
        {!forceExpanded && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            aria-pressed={collapsed}
            className={cn('text-muted-foreground', !collapsed && 'ml-auto')}
          >
            <ChevronLeft
              className={cn('transition-transform', collapsed && 'rotate-180')}
              aria-hidden
            />
          </Button>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Navegación principal">
        <ul className="flex flex-col gap-1">
          {PRIMARY_NAV.map((item) => (
            <li key={item.to}>
              <NavRow
                item={item}
                collapsed={collapsed}
                active={isActive(item.to)}
                onNavigate={handleNavigate}
              />
            </li>
          ))}
        </ul>

        <div className="my-3 border-t border-border" />

        {!collapsed && (
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Herramientas
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {SECONDARY_NAV.map((item) => (
            <li key={item.to}>
              <NavRow
                item={item}
                collapsed={collapsed}
                active={isActive(item.to)}
                onNavigate={handleNavigate}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer: perfil + acciones */}
      <div className="border-t border-border p-2">
        {user && (
          <NavLink
            to="/perfil"
            onClick={handleNavigate}
            title={collapsed ? `${user.firstName} ${user.lastName}` : 'Mi perfil'}
            aria-label="Mi perfil"
            className={cn(
              'mb-1 flex items-center gap-3 rounded-md px-3 py-2 outline-none transition-colors',
              'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
              collapsed && 'justify-center px-0',
              isActive('/perfil') && 'bg-primary/10 text-primary',
            )}
            aria-current={isActive('/perfil') ? 'page' : undefined}
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
              aria-hidden
            >
              {initials(user.firstName, user.lastName)}
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            )}
          </NavLink>
        )}

        <div className={cn('flex flex-col gap-1', collapsed && 'items-center')}>
          <IconAction
            icon={Settings}
            label="Configuración"
            collapsed={collapsed}
            onClick={() => {
              handleNavigate();
              navigate('/configuracion');
            }}
          />
          <NotificationBell variant={collapsed ? 'icon' : 'row'} />
          <IconAction
            icon={LogOut}
            label="Cerrar sesión"
            collapsed={collapsed}
            onClick={() => {
              void logout();
            }}
          />
        </div>
      </div>
    </div>
  );
}
