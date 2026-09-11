import { useId, useState, type ReactNode } from 'react';
import { LayoutDashboard, Users } from 'lucide-react';
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { useHasPermission } from '@/hooks/use-has-permission';
import { DirectorioView } from './directorio-view';
import { TrabajadorDetalle } from './trabajador-detalle';
import type { RrhhTab } from './rrhh-shared';

/**
 * RRHH — antes "Directorio".
 *
 * Centraliza al trabajador y su habilitación para ir a faena. Dos pestañas: el
 * tablero, para ver la situación de todos sin abrir fichas, y el directorio,
 * para llegar a una persona concreta.
 *
 * La búsqueda del directorio vive acá y no dentro de la vista: al volver de una
 * ficha hay que encontrar el listado como se dejó, y si el estado muriera con
 * la vista habría que buscar de nuevo cada vez.
 */

const TABS: ReadonlyArray<TabItem<RrhhTab>> = [
  { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { value: 'directorio', label: 'Directorio', icon: Users },
];

export default function RrhhPage(): ReactNode {
  const [tab, setTab] = useState<RrhhTab>('directorio');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const idBase = useId();

  // Consultar y editar son permisos distintos: quien solo consulta ve la ficha
  // completa pero sin botones de carga.
  const puedeEditar = useHasPermission('hr:manage');

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="RRHH"
        description="Trabajadores, antecedentes laborales y requisitos para ir a faena."
      />

      <Tabs<RrhhTab>
        aria-label="Secciones de RRHH"
        items={TABS}
        value={tab}
        onValueChange={(t) => {
          setTab(t);
          setAbierto(null);
        }}
        idBase={idBase}
      />

      <div
        role="tabpanel"
        id={tabPanelId(idBase, tab)}
        aria-labelledby={tabTriggerId(idBase, tab)}
        tabIndex={0}
        className="mt-4"
      >
        {tab === 'directorio' &&
          (abierto ? (
            <TrabajadorDetalle
              userId={abierto}
              puedeEditar={puedeEditar}
              onVolver={() => setAbierto(null)}
            />
          ) : (
            <DirectorioView onAbrir={setAbierto} busqueda={busqueda} onBusqueda={setBusqueda} />
          ))}

        {tab === 'dashboard' && (
          <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            El tablero de RRHH es la siguiente etapa. Mientras tanto, el directorio ya muestra por
            trabajador cuántos requisitos tiene vencidos y por vencer, y se puede filtrar por esa
            situación.
          </p>
        )}
      </div>
    </PageContainer>
  );
}
