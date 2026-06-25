import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Fila de un item del CV (experiencia / educación / certificación). Muestra
 * título, subtítulo, meta (periodo) y un slot extra opcional (p. ej. enlace al
 * diploma), con acciones de editar y eliminar. Se separan con `divide-y` desde
 * el contenedor padre.
 */
export function CvItemRow({
  title,
  subtitle,
  meta,
  extra,
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
}: {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  extra?: ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  editLabel: string;
  deleteLabel: string;
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium leading-tight">{title}</p>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        {extra}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={editLabel}
          title={editLabel}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label={deleteLabel}
          title={deleteLabel}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}
