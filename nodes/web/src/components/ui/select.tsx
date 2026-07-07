import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Props del {@link Select}. Extiende los atributos nativos de `<select>` pero
 * hace `aria-label` OBLIGATORIA a nivel de tipos: un `<select>` sin `<Label>`
 * asociado necesita un nombre accesible. Si el control ya está etiquetado por un
 * `<Label htmlFor>` visible, pasa igualmente `aria-label` (o cámbialo a
 * `aria-labelledby` según el caso) — nunca dejes el select sin nombre accesible.
 */
export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Nombre accesible del control (REQUERIDO). */
  'aria-label': string;
}

/**
 * `<select>` nativo estilizado idéntico a {@link Input}: misma altura (`h-9`),
 * `rounded-md`, `border-input` y el focus canónico del design system. Nativo a
 * propósito (mobile-first: usa el picker del sistema). `forwardRef`, export
 * nombrado. El nombre accesible es obligatorio por tipos (`aria-label`).
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors',
          'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/40',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';

export { Select };
