import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Ancho máximo del contenido de la página. */
type MaxWidth = '3xl' | '6xl' | '7xl';

/** Separación vertical (escala de gap del design system) entre bloques. */
type Gap = 4 | 6 | 8;

export interface PageContainerProps {
  /** Ancho máximo del contenido (default: `7xl`). */
  maxWidth?: MaxWidth;
  /** Separación vertical entre hijos (default: `6`). */
  gap?: Gap;
  /** Contenido de la página. */
  children: ReactNode;
  /** Clase opcional adicional. */
  className?: string;
}

const MAX_WIDTH: Record<MaxWidth, string> = {
  '3xl': 'max-w-3xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
};

const GAP: Record<Gap, string> = {
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
};

/**
 * Contenedor de página centrado con el padding responsivo canónico
 * (`px-4 py-8 sm:px-6 sm:py-10`) y una columna flex con `gap` configurable.
 * Encapsula el layout raíz que repiten las secciones (Finanzas, Recursos, etc.).
 */
export function PageContainer({
  maxWidth = '7xl',
  gap = 6,
  children,
  className,
}: PageContainerProps): ReactNode {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col px-4 py-8 sm:px-6 sm:py-10',
        MAX_WIDTH[maxWidth],
        GAP[gap],
        className,
      )}
    >
      {children}
    </div>
  );
}
