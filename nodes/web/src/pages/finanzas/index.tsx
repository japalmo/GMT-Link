import { useId, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, Clock, Receipt } from 'lucide-react';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { ReembolsosTab } from './reembolsos';
import { HorasExtraTab } from './horas-extra';
import { VistaGeneralTab } from './vista-general';

/** Pestaña activa del módulo Finanzas. */
export type FinanzasTab = 'general' | 'reembolsos' | 'horas';

/** Definición de las pestañas de Finanzas (valor, etiqueta e icono). */
const FINANZAS_TABS: ReadonlyArray<TabItem<FinanzasTab>> = [
  { value: 'general', label: 'Vista general', icon: LayoutDashboard },
  { value: 'reembolsos', label: 'Reembolsos', icon: Receipt },
  { value: 'horas', label: 'Horas extra', icon: Clock },
];

/**
 * Página Finanzas (spec §5). Cáscara: header + toggle de pestañas. La pestaña
 * activa vive en la URL (`/finanzas/:tab`) para que los links de notificaciones
 * (`/finanzas/reembolsos`, `/finanzas/horas`) aterricen donde corresponde.
 * Todas las pestañas son visibles para todo usuario autenticado; el gating de
 * acciones (ver todo / aprobar / pagar / imprimir) se resuelve por permiso
 * dentro de cada Tab (`useHasPermission`). Liquidaciones fue removida (§5.1) y
 * cualquier ruta legacy (`/finanzas/liquidaciones`) redirige a la Vista general.
 */
export default function FinanzasPage(): ReactNode {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const idBase = useId();

  const activeTab: FinanzasTab =
    tab === 'reembolsos' || tab === 'horas' || tab === 'general' ? tab : 'general';

  // `/finanzas/liquidaciones` (o cualquier tab legacy) redirige a la Vista general.
  if (tab && tab !== 'reembolsos' && tab !== 'horas' && tab !== 'general') {
    return <Navigate to="/finanzas/general" replace />;
  }

  const handleTabChange = (newTab: FinanzasTab): void => {
    navigate(`/finanzas/${newTab}`);
  };

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Finanzas"
        description="Vista general, reembolsos y horas extra."
      />
      <Tabs
        items={FINANZAS_TABS}
        value={activeTab}
        onValueChange={handleTabChange}
        aria-label="Secciones de finanzas"
        idBase={idBase}
      />

      <TabPanel idBase={idBase} value={activeTab}>
        {activeTab === 'general' && <VistaGeneralTab />}
        {activeTab === 'reembolsos' && <ReembolsosTab />}
        {activeTab === 'horas' && <HorasExtraTab />}
      </TabPanel>
    </PageContainer>
  );
}
