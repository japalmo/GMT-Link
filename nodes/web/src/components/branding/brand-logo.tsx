import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import isoDark from '@/assets/branding/link-iso-dark.svg';
import isoLight from '@/assets/branding/link-iso-light.svg';
import logoDark from '@/assets/branding/link-logo-dark.svg';
import logoLight from '@/assets/branding/link-logo-light.svg';

/**
 * Marca GMT Link en SVG, consciente del tema. Renderiza las DOS variantes (light
 * y dark) y el CSS de tema (`.brand-light-only` / `.brand-dark-only`, definidas en
 * index.css sobre la clase `.dark` del html) muestra la correcta: light sobre
 * fondos claros, dark (con halo blanco) sobre fondos oscuros.
 *
 * `variant`: `logo` = logotipo completo (isotipo + "Link", formato vertical);
 * `iso` = solo el isotipo (eslabones). La altura la fija el consumidor vía
 * `className` (p. ej. `h-14`); el ancho se ajusta solo.
 */
export function BrandLogo({
  variant = 'logo',
  className,
  alt = 'GMT Link',
  'aria-hidden': ariaHidden,
}: {
  variant?: 'logo' | 'iso';
  className?: string;
  alt?: string;
  /** Oculta TODO el logo del árbol de accesibilidad (p. ej. la variante desvanecida del sidebar). */
  'aria-hidden'?: boolean;
}): ReactNode {
  const src = variant === 'logo' ? { light: logoLight, dark: logoDark } : { light: isoLight, dark: isoDark };
  // Ambos <img> llevan el mismo alt: el CSS de tema deja exactamente UNO visible
  // (display:none saca al otro del árbol de accesibilidad), así que nunca se
  // anuncia dos veces y el logo conserva su nombre accesible en ambos temas.
  return (
    <span
      className={cn('inline-flex items-center justify-center', className)}
      aria-hidden={ariaHidden || undefined}
    >
      <img src={src.light} alt={alt} className="brand-light-only h-full w-auto object-contain" />
      <img src={src.dark} alt={alt} className="brand-dark-only h-full w-auto object-contain" />
    </span>
  );
}

/**
 * Marca del sidebar con transición limpia logotipo ↔ isotipo: ambos quedan
 * montados y el colapso hace crossfade + escala (300 ms), coordinado con la
 * transición de ancho del rail. `forceExpanded` (drawer móvil) muestra siempre
 * el logotipo completo.
 */
export function SidebarBrand({ collapsed }: { collapsed: boolean }): ReactNode {
  return (
    <span className="relative flex h-14 items-center justify-center">
      {/* La variante desvanecida (opacity-0) sigue en el árbol de accesibilidad:
          se oculta con aria-hidden para no anunciar la marca dos veces. */}
      <BrandLogo
        variant="logo"
        aria-hidden={collapsed}
        className={cn(
          'h-14 transition-all duration-300',
          collapsed ? 'scale-75 opacity-0' : 'scale-100 opacity-100',
        )}
      />
      <BrandLogo
        variant="iso"
        aria-hidden={!collapsed}
        className={cn(
          'absolute inset-0 m-auto h-10 transition-all duration-300',
          collapsed ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
        )}
      />
    </span>
  );
}
