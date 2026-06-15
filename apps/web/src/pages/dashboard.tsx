import { useState, type ReactNode } from 'react';
import { AlertCircle, LayoutDashboard, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/context/auth-context';
import { useDashboard } from '@/hooks/use-dashboard';
import { OnboardingTour } from '@/components/onboarding-tour';
import { DashboardCustomizer } from '@/pages/dashboard/dashboard-customizer';
import { renderWidget } from '@/pages/dashboard/widgets/registry';
import type { DashboardLayoutItem } from '@/types/dashboard';

/**
 * Dashboard modular configurable por usuario (§6-2.1).
 *
 * Renderiza los widgets VISIBLES en el orden persistido; cada widget trae su
 * propio dato reusando endpoints existentes y gestiona sus estados
 * carga/vacío/error. El modo "Personalizar" abre un editor donde el usuario
 * muestra/oculta y reordena widgets; al guardar persiste vía PUT y sale del
 * modo edición. Mantiene el saludo y el tour de onboarding arriba.
 */
export default function DashboardPage(): ReactNode {
  const { user } = useAuth();
  const { widgets, layout, loading, error, refetch, save } = useDashboard();
  const [editing, setEditing] = useState(false);

  const visible: DashboardLayoutItem[] = layout
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order);

  const handleSave = async (next: DashboardLayoutItem[]): Promise<void> => {
    await save(next);
    setEditing(false);
  };

  const titleFor = (key: string): string =>
    widgets.find((w) => w.key === key)?.title ?? key;
  const descFor = (key: string): string =>
    widgets.find((w) => w.key === key)?.description ?? '';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Dashboard</p>
          <h1 className="text-2xl font-bold tracking-tight">
            Hola{user ? `, ${user.firstName}` : ''}.
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tu panel personalizado. Acomoda los widgets a tu medida y la
            disposición quedará guardada.
          </p>
        </div>
        {!editing && widgets.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            className="self-start sm:self-auto"
          >
            <Settings2 className="size-4" aria-hidden />
            Personalizar
          </Button>
        )}
      </header>

      <OnboardingTour />

      {editing ? (
        <DashboardCustomizer
          widgets={widgets}
          layout={layout}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      ) : loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="size-8 text-destructive" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyDashboard
          hasWidgets={widgets.length > 0}
          onCustomize={() => setEditing(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <div key={item.widgetKey}>
              {renderWidget(
                item.widgetKey,
                titleFor(item.widgetKey),
                descFor(item.widgetKey),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Estado vacío: el usuario ocultó todo, o no tiene widgets disponibles. */
function EmptyDashboard({
  hasWidgets,
  onCustomize,
}: {
  hasWidgets: boolean;
  onCustomize: () => void;
}): ReactNode {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <LayoutDashboard className="size-8 text-muted-foreground" aria-hidden />
        {hasWidgets ? (
          <>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ocultaste todos los widgets. Personaliza tu panel para volver a
              mostrarlos.
            </p>
            <Button variant="outline" size="sm" onClick={onCustomize}>
              <Settings2 className="size-4" aria-hidden />
              Personalizar
            </Button>
          </>
        ) : (
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay widgets disponibles para tu cuenta.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Esqueleto de carga del grid de widgets (respeta la grilla responsive). */
function DashboardSkeleton(): ReactNode {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-hidden
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-3 py-6">
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="size-9 animate-pulse rounded-md bg-muted" />
            </div>
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
