import { useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDashboard } from '@/hooks/use-dashboard';
import { renderWidget } from '@/pages/dashboard/widgets/registry';
import { DashboardCustomizer } from '@/pages/dashboard/dashboard-customizer';
import { Button } from '@/components/ui/button';

/**
 * Inicio (dashboard modular §6-2.1). Carga los widgets + layout reconciliado del
 * usuario (`useDashboard` → GET /dashboard/me) y renderiza cada widget visible en
 * su orden con `renderWidget`. El catálogo del backend define el set por defecto
 * (accesos-directos, mis-tareas-pendientes, config de cuenta van primero). El
 * botón "Personalizar" abre el editor de orden/visibilidad.
 */
export default function DashboardPage(): ReactNode {
  const { user } = useAuth();
  const { widgets, layout, loading, error, refetch, save } = useDashboard();
  const [editing, setEditing] = useState(false);

  const titleFor = (key: string): string =>
    widgets.find((w) => w.key === key)?.title ?? key;
  const descFor = (key: string): string =>
    widgets.find((w) => w.key === key)?.description ?? '';

  const visible = [...layout]
    .filter((it) => it.visible)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Inicio</p>
          <h1 className="text-2xl font-bold tracking-tight">
            Hola{user ? `, ${user.firstName}` : ''}.
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Resumen general de tareas y actividades en curso.
          </p>
        </div>
        {!loading && !error && (
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            <Settings2 className="mr-2 h-4 w-4" />
            {editing ? 'Cerrar' : 'Personalizar'}
          </Button>
        )}
      </header>

      {loading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl border bg-muted/40"
              aria-hidden
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {!loading && !error && editing && (
        <DashboardCustomizer
          widgets={widgets}
          layout={layout}
          onSave={async (next) => {
            await save(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {!loading && !error && !editing && (
        visible.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            No tienes widgets visibles. Usa "Personalizar" para activarlos.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {visible.map((it) => (
              <div key={it.widgetKey} className="min-w-0">
                {renderWidget(
                  it.widgetKey,
                  titleFor(it.widgetKey),
                  descFor(it.widgetKey),
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
