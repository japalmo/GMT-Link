import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- *
 * Tabs (modo button) — canon de `finanzas-tabs.tsx`.
 * role=tablist/tab, aria-selected, focus 4-partes de botones/tabs.
 * Patrón WAI-ARIA completo: enlace tab↔panel (`id`/`aria-controls`), roving
 * tabindex y navegación por flechas/Home/End en el tablist.
 * -------------------------------------------------------------------------- */

/** Id del botón de la pestaña `value` bajo el prefijo `idBase`. */
export function tabTriggerId(idBase: string, value: string): string {
  return `${idBase}-tab-${value}`;
}

/** Id del panel (`role="tabpanel"`) de la pestaña `value` bajo `idBase`. */
export function tabPanelId(idBase: string, value: string): string {
  return `${idBase}-panel-${value}`;
}

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
  /**
   * Prefijo de ids para enlazar cada tab con su panel (WAI-ARIA). Cada botón
   * emite `id={idBase-tab-value}` y `aria-controls={idBase-panel-value}`; el
   * consumidor debe envolver el panel activo con `<TabPanel idBase value>` (o los
   * helpers `tabTriggerId`/`tabPanelId`). Si se omite, se genera uno con `useId`
   * (los tabs siguen funcionando y con navegación por teclado, pero sin un panel
   * al que apuntar). Pásalo desde el consumidor para completar el enlace.
   */
  readonly idBase?: string;
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
  idBase: providedIdBase,
}: TabsProps<V>): ReactNode {
  // `useId` como fallback: garantiza ids únicos aunque haya varios `Tabs` en la
  // página y el consumidor no entregue un `idBase`.
  const autoId = useId();
  const idBase = providedIdBase ?? autoId;

  /**
   * Roving tabindex: dentro del tablist las flechas mueven foco + activan tab,
   * Home/End saltan a los extremos (patrón WAI-ARIA de tabs horizontales).
   */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const currentIndex = items.findIndex((item) => item.value === value);
    if (currentIndex === -1) return;
    const lastIndex = items.length - 1;

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
        break;
      case 'ArrowLeft':
        nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = lastIndex;
        break;
      default:
        return;
    }

    const next = items[nextIndex];
    if (!next) return;
    event.preventDefault();
    onValueChange(next.value);
    // El botón destino ya existe en el DOM (todos se renderizan): le movemos el
    // foco para acompañar la selección.
    const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[nextIndex]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        // Móvil: scroll horizontal cuando las pestañas no caben (barra oculta).
        // Desktop (sm:): ancho natural. `flex-1` en los botones las expande cuando
        // caben y, al desbordar, respetan su ancho de contenido y aparece el scroll.
        'inline-flex w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:w-auto [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map(({ value: tabValue, label, icon: Icon }) => {
        const isActive = value === tabValue;
        return (
          <button
            key={tabValue}
            id={tabTriggerId(idBase, tabValue)}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={tabPanelId(idBase, tabValue)}
            tabIndex={isActive ? 0 : -1}
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
 * TabPanel — panel enlazado a su tab (modo button).
 * -------------------------------------------------------------------------- */

export interface TabPanelProps {
  /** Mismo `idBase` que se pasó a `Tabs`. */
  readonly idBase: string;
  /** Valor de la pestaña a la que pertenece este panel. */
  readonly value: string;
  /** Contenido del panel. */
  readonly children: ReactNode;
  /** Clase opcional del contenedor `tabpanel`. */
  readonly className?: string;
}

/**
 * Panel de una pestaña (modo button). Cierra el patrón WAI-ARIA: `role="tabpanel"`
 * con `id`/`aria-labelledby` que enlazan de vuelta al botón de su pestaña y
 * `tabIndex={0}` para que el panel reciba foco al navegar con teclado. Los
 * consumidores renderizan los paneles de forma condicional: basta envolver el
 * panel activo.
 */
export function TabPanel({ idBase, value, children, className }: TabPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idBase, value)}
      aria-labelledby={tabTriggerId(idBase, value)}
      tabIndex={0}
      className={className}
    >
      {children}
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
