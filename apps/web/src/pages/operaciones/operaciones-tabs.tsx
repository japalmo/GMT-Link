import type { ReactNode } from 'react';
import { Briefcase, Kanban, Files } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OperacionesTab = 'proyectos' | 'backlog' | 'documentos';

interface OperacionesTabsProps {
  active: OperacionesTab;
  onChange: (tab: OperacionesTab) => void;
}

const TABS: ReadonlyArray<{ value: OperacionesTab; label: string; icon: typeof Briefcase }> = [
  { value: 'proyectos', label: 'Proyectos', icon: Briefcase },
  { value: 'backlog', label: 'Backlog (Kanban)', icon: Kanban },
  { value: 'documentos', label: 'Documentos', icon: Files },
];

export function OperacionesTabs({ active, onChange }: OperacionesTabsProps): ReactNode {
  return (
    <div
      role="tablist"
      aria-label="Secciones de operaciones"
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
