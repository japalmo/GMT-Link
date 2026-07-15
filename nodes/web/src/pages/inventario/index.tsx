import { useId, useState, type ReactNode } from 'react';
import { Building, ClipboardList, FileSpreadsheet, Package } from 'lucide-react';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import { useHasPermission } from '@/hooks/use-has-permission';
import BodegasPage from '@/pages/bodegas';
import ProveedoresPage from '@/pages/proveedores';
import { ArticulosTab } from './articulos-tab';
import { SolicitudesTab } from './solicitudes-tab';

type InventarioTab = 'articulos' | 'solicitudes' | 'bodegas' | 'proveedores';

const TAB_ITEMS: ReadonlyArray<TabItem<InventarioTab>> = [
  { value: 'articulos', label: 'Artículos', icon: Package },
  { value: 'solicitudes', label: 'Solicitudes', icon: ClipboardList },
  { value: 'bodegas', label: 'Bodegas', icon: FileSpreadsheet },
  { value: 'proveedores', label: 'Proveedores', icon: Building },
];

/**
 * Módulo Inventario (gate de módulo `inventario` vía `RequireModule` en App.tsx;
 * el backend además exige `inventory:access` en cada endpoint). Cuatro pestañas:
 * el catálogo de artículos, la gestión de solicitudes de insumos (con el
 * historial de entregas) y las páginas existentes de Bodegas y Proveedores
 * montadas como paneles (mismo patrón que usaba Recursos). Las pestañas Bodegas
 * y Proveedores exigen ADEMÁS sus permisos propios (`warehouse:access` /
 * `provider:access`): un rol custom con solo `inventory:access` no monta
 * paneles cuyos endpoints le devolverían 403.
 */
export default function InventarioPage(): ReactNode {
  const [activeTab, setActiveTab] = useState<InventarioTab>('articulos');
  const idBase = useId();

  const canWarehouses = useHasPermission('warehouse:access');
  const canProviders = useHasPermission('provider:access');
  const tabItems = TAB_ITEMS.filter((tab) => {
    if (tab.value === 'bodegas') return canWarehouses;
    if (tab.value === 'proveedores') return canProviders;
    return true;
  });
  // Si la pestaña activa deja de estar visible (permisos recién resueltos),
  // se degrada al catálogo en vez de montar un panel sin permiso.
  const effectiveTab = tabItems.some((tab) => tab.value === activeTab) ? activeTab : 'articulos';

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Inventario"
        description="Administra el catálogo de artículos, las solicitudes de insumos, las bodegas y los proveedores."
      />

      <Tabs<InventarioTab>
        aria-label="Secciones de inventario"
        items={tabItems}
        value={effectiveTab}
        onValueChange={setActiveTab}
        idBase={idBase}
      />

      <div
        role="tabpanel"
        id={tabPanelId(idBase, effectiveTab)}
        aria-labelledby={tabTriggerId(idBase, effectiveTab)}
        tabIndex={0}
        className="mt-4"
      >
        {effectiveTab === 'articulos' && <ArticulosTab />}
        {effectiveTab === 'solicitudes' && <SolicitudesTab />}
        {effectiveTab === 'bodegas' && canWarehouses && <BodegasPage />}
        {effectiveTab === 'proveedores' && canProviders && <ProveedoresPage />}
      </div>
    </PageContainer>
  );
}
