import { useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDashboard } from '@/hooks/use-dashboard';
import { renderWidget } from '@/pages/dashboard/widgets/registry';
import { DashboardCustomizer } from '@/pages/dashboard/dashboard-customizer';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';

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
    <PageContainer maxWidth="6xl">
      <PageHeader
        label="Inicio"
        title={`Hola${user ? `, ${user.firstName}` : ''}.`}
        description="Resumen general de tareas y actividades en curso."
        actions={
          !loading && !error ? (
            <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
              <Settings2 className="mr-2 h-4 w-4" />
              {editing ? 'Cerrar' : 'Personalizar'}
            </Button>
          ) : undefined
        }
      />

      {loading && <LoadingState rows={4} label="Cargando tu inicio…" />}

      {!loading && error && <ErrorState message={error} onRetry={() => void refetch()} />}

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
          <EmptyState message='No tienes widgets visibles. Usa "Personalizar" para activarlos.' />
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
    </PageContainer>
  );
}
