import { forwardRef, useId } from 'react';
import { Search } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface SearchInputProps extends Omit<InputProps, 'type'> {
  /**
   * Etiqueta accesible (`sr-only`) del campo. Da nombre accesible al input sin
   * ocupar espacio visible. Default: "Buscar".
   */
  label?: string;
}

/**
 * Campo de búsqueda del design system: {@link Input} `type="search"` con un
 * icono `Search` a la izquierda (`pointer-events-none`, `aria-hidden`) y una
 * `Label` `sr-only` asociada. El `placeholder` cae a la etiqueta si no se pasa.
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, label = 'Buscar', id, placeholder, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <div className={cn('relative flex-1', className)}>
        <Label htmlFor={inputId} className="sr-only">
          {label}
        </Label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={ref}
          id={inputId}
          type="search"
          className="pl-9"
          placeholder={placeholder ?? label}
          {...props}
        />
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';

export { SearchInput };
