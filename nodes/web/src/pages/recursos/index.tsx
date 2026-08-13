import { useState, useEffect, useId, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wrench, Car, Construction } from 'lucide-react';
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import type { RecursosTab, AssetDetailTarget } from './recursos-shared';
import { ActivosCatalogView } from './activos-catalog-view';
import { AssetDetailView } from './asset-detail-view';

export default function RecursosPage(): ReactNode {
  // Todas las pestañas son visibles para cualquier usuario: equipos, vehículos
  // y maquinaria.
  const [activeTab, setActiveTab] = useState<RecursosTab>('equipos');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  // Destino inicial del detalle: 'checklist' aterriza en la pestaña Ficha con
  // scroll al checklist (flujo "Poner en uso" de un vehículo desde la tabla);
  // 'documentos'/'reportar-uso' llegan por deep-link desde la ficha pública (QR).
  const [detailTarget, setDetailTarget] = useState<AssetDetailTarget | null>(null);
  const idBase = useId();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link desde la ficha pública (QR): `?asset=<id>&accion=ver-docs|reportar-uso`
  // abre el detalle del activo directo en la vista/acción pedida. Se consume UNA vez
  // y se limpian los params (replace) para no reaccionar de nuevo ni dejarlos en la
  // URL/historial. Al llegar por deep-link ya se pasó por los guards (si no había
  // sesión, ProtectedRoute preservó el destino y PublicRoute volvió tras loguear).
  useEffect(() => {
    const assetId = searchParams.get('asset');
    if (!assetId) return;
    const accion = searchParams.get('accion');
    const target: AssetDetailTarget | null =
      accion === 'reportar-uso' ? 'reportar-uso' : accion === 'ver-docs' ? 'documentos' : null;
    setSelectedAssetId(assetId);
    setDetailTarget(target);
    const next = new URLSearchParams(searchParams);
    next.delete('asset');
    next.delete('accion');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const tabItems: TabItem<RecursosTab>[] = [
    { value: 'equipos', label: 'Equipos', icon: Wrench },
    { value: 'vehiculos', label: 'Vehículos', icon: Car },
    { value: 'maquinaria', label: 'Maquinaria', icon: Construction },
  ];

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Recursos Físicos"
        description="Administra los activos, vehículos y maquinaria de GMT."
      />

      <Tabs<RecursosTab>
        aria-label="Secciones de recursos"
        items={tabItems}
        value={activeTab}
        onValueChange={(tab) => {
          setActiveTab(tab);
          setSelectedAssetId(null);
          setDetailTarget(null);
        }}
        idBase={idBase}
      />

      {/* Tab Content */}
      <div
        role="tabpanel"
        id={tabPanelId(idBase, activeTab)}
        aria-labelledby={tabTriggerId(idBase, activeTab)}
        tabIndex={0}
        className="mt-4"
      >
        {selectedAssetId ? (
          <AssetDetailView
            id={selectedAssetId}
            initialTarget={detailTarget}
            onBack={() => {
              setSelectedAssetId(null);
              setDetailTarget(null);
            }}
          />
        ) : (
          <ActivosCatalogView
            key={activeTab}
            subsection={
              activeTab === 'vehiculos'
                ? 'vehiculos'
                : activeTab === 'maquinaria'
                  ? 'maquinaria'
                  : 'equipos'
            }
            onSelectAsset={(id, target) => {
              setSelectedAssetId(id);
              setDetailTarget(target ?? null);
            }}
          />
        )}
      </div>
    </PageContainer>
  );
}
