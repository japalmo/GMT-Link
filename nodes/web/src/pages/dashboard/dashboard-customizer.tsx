import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { AvailableWidget, DashboardLayoutItem } from '@/types/dashboard';

/** Reordena un layout moviendo el ítem en `index` una posición (dir = -1 | 1). */
function move(
  layout: DashboardLayoutItem[],
  index: number,
  dir: -1 | 1,
): DashboardLayoutItem[] {
  const target = index + dir;
  if (target < 0 || target >= layout.length) return layout;
  const item = layout[index];
  if (!item) return layout;
  const next = [...layout];
  next.splice(index, 1);
  next.splice(target, 0, item);
  // Recompactamos el `order` para mantener 0..n-1.
  return next.map((it, i) => ({ ...it, order: i }));
}

/**
 * Editor del dashboard ("Personalizar", §6-2.1). Lista los widgets en su orden
 * actual y permite (a) mostrar/ocultar cada uno y (b) reordenar con botones
 * subir/bajar (sin librerías nuevas). Trabaja sobre un borrador local; al
 * Guardar emite el layout y deja que el padre lo persista (PUT).
 */
export function DashboardCustomizer({
  widgets,
  layout,
  onSave,
  onCancel,
}: {
  widgets: AvailableWidget[];
  layout: DashboardLayoutItem[];
  onSave: (layout: DashboardLayoutItem[]) => Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<DashboardLayoutItem[]>(layout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleFor = (key: string): string =>
    widgets.find((w) => w.key === key)?.title ?? key;
  const descFor = (key: string): string =>
    widgets.find((w) => w.key === key)?.description ?? '';

  const toggle = (key: string): void => {
    setDraft((prev) =>
      prev.map((it) => (it.widgetKey === key ? { ...it, visible: !it.visible } : it)),
    );
  };

  const reorder = (index: number, dir: -1 | 1): void => {
    setDraft((prev) => move(prev, index, dir));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch {
      setError('No se pudo guardar la disposición. Inténtalo de nuevo.');
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">Personalizar panel</h2>
        <p className="text-sm text-muted-foreground">
          Muestra u oculta widgets y cambia su orden. Guarda para aplicar los
          cambios.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {draft.map((item, index) => {
          const checkboxId = `widget-visible-${item.widgetKey}`;
          return (
            <li
              key={item.widgetKey}
              className={cn(
                'flex items-center gap-3 p-3',
                !item.visible && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => reorder(index, -1)}
                  disabled={index === 0 || saving}
                  aria-label={`Subir ${titleFor(item.widgetKey)}`}
                  className="size-8 text-muted-foreground"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => reorder(index, 1)}
                  disabled={index === draft.length - 1 || saving}
                  aria-label={`Bajar ${titleFor(item.widgetKey)}`}
                  className="size-8 text-muted-foreground"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
              </div>

              <Label
                htmlFor={checkboxId}
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
              >
                <span className="truncate text-sm font-medium">
                  {titleFor(item.widgetKey)}
                </span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {descFor(item.widgetKey)}
                </span>
              </Label>

              <div className="flex items-center gap-2">
                {item.visible ? (
                  <Eye className="size-4 text-muted-foreground" aria-hidden />
                ) : (
                  <EyeOff className="size-4 text-muted-foreground" aria-hidden />
                )}
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={item.visible}
                  onChange={() => toggle(item.widgetKey)}
                  disabled={saving}
                  className="size-4 cursor-pointer rounded border-input text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${item.visible ? 'Ocultar' : 'Mostrar'} ${titleFor(item.widgetKey)}`}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <Alert variant="destructive" live>
          {error}
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => void handleSave()} loading={saving}>
          Guardar disposición
        </Button>
      </div>
    </div>
  );
}
