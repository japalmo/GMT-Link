import type { ReactNode } from 'react';
import { Clock, Receipt, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Pestaña activa del módulo Finanzas. */
export type FinanzasTab = 'reembolsos' | 'horas' | 'liquidaciones';

interface FinanzasTabsProps {
  /** Pestaña actualmente activa. */
  active: FinanzasTab;
  /** Cambia la pestaña activa. */
  onChange: (tab: FinanzasTab) => void;
}

/** Definición de cada pestaña (valor, etiqueta e icono). */
const TABS: ReadonlyArray<{ value: FinanzasTab; label: string; icon: typeof Receipt }> = [
  { value: 'reembolsos', label: 'Reembolsos', icon: Receipt },
  { value: 'horas', label: 'Horas extra', icon: Clock },
  { value: 'liquidaciones', label: 'Liquidaciones', icon: FileText },
];


/**
 * Toggle accesible (dos botones tipo pill) entre Reembolsos y Horas extra.
 * Mobile-first: ocupa el ancho disponible en pantallas chicas y se ajusta al
 * contenido en ≥640px. Usa `role="tablist"` para semántica de pestañas.
 */
export function FinanzasTabs({ active, onChange }: FinanzasTabsProps): ReactNode {
  return (
    <div
      role="tablist"
      aria-label="Secciones de finanzas"
      className="inline-flex w-full gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:w-auto"
    >
      {TABS.map(({ value, label, icon: Icon }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(value)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              isActive
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
