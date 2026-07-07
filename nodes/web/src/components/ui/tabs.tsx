import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- *
 * Tabs (modo button) — canon de `finanzas-tabs.tsx`.
 * role=tablist/tab, aria-selected, focus 4-partes de botones/tabs.
 * -------------------------------------------------------------------------- */

/** Una pestaña del modo button. */
export interface TabItem<V extends string = string> {
  /** Valor único de la pestaña. */
  readonly value: V;
  /** Etiqueta visible. */
  readonly label: string;
  /** Icono lucide opcional a la izquierda. */
  readonly icon?: LucideIcon;
}

export interface TabsProps<V extends string = string> {
  /** Definición de pestañas. */
  readonly items: ReadonlyArray<TabItem<V>>;
  /** Valor de la pestaña activa. */
  readonly value: V;
  /** Cambia la pestaña activa. */
  readonly onValueChange: (value: V) => void;
  /** Etiqueta accesible del `tablist` (REQUERIDA para nombrar el grupo). */
  readonly 'aria-label': string;
  /** Clase opcional del contenedor `tablist`. */
  readonly className?: string;
}

/**
 * Pestañas tipo pill (modo button) — el patrón de Finanzas / Operaciones /
 * Recursos / Directorio. Semántica `role="tablist"`/`role="tab"` con
 * `aria-selected` y el focus canónico de 4 partes de botones/tabs.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: TabsProps<V>): ReactNode {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex w-full gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:w-auto',
        className,
      )}
    >
      {items.map(({ value: tabValue, label, icon: Icon }) => {
        const isActive = value === tabValue;
        return (
          <button
            key={tabValue}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onValueChange(tabValue)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * NavTabs (modo NavLink) — canon de `profile-tabs.tsx`.
 * aria-current="page" (vía NavLink isActive), subrayado inferior.
 * -------------------------------------------------------------------------- */

/** Una pestaña de navegación (ruta). */
export interface NavTabItem {
  /** Ruta de destino. */
  readonly to: string;
  /** Etiqueta visible. */
  readonly label: string;
  /** Icono lucide opcional. */
  readonly icon?: LucideIcon;
  /**
   * Coincidencia exacta de ruta (`NavLink end`). Útil en la pestaña índice para
   * que no quede activa en las sub-rutas.
   */
  readonly end?: boolean;
}

export interface NavTabsProps {
  /** Definición de pestañas de navegación. */
  readonly items: ReadonlyArray<NavTabItem>;
  /** Etiqueta accesible del grupo de navegación (REQUERIDA). */
  readonly 'aria-label': string;
  /** Clase opcional del `<nav>`. */
  readonly className?: string;
}

/**
 * Pestañas de navegación (modo NavLink) — el patrón de Perfil. `NavLink` marca
 * `aria-current="page"` en la ruta activa. Subrayado inferior y scroll
 * horizontal en móvil.
 */
export function NavTabs({
  items,
  'aria-label': ariaLabel,
  className,
}: NavTabsProps): ReactNode {
  return (
    <nav aria-label={ariaLabel} className={cn('-mb-px overflow-x-auto', className)}>
      <ul className="flex min-w-max gap-1 border-b border-border">
        {items.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )
                }
              >
                {Icon && <Icon className="size-4" aria-hidden />}
                {tab.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
