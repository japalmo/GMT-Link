import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Clock, Receipt, FileText } from 'lucide-react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { ReembolsosTab } from './reembolsos';
import { HorasExtraTab } from './horas-extra';
import { LiquidacionesTab } from './liquidaciones';

/** Pestaña activa del módulo Finanzas. */
export type FinanzasTab = 'reembolsos' | 'horas' | 'liquidaciones';

/** Definición de las pestañas de Finanzas (valor, etiqueta e icono). */
const FINANZAS_TABS: ReadonlyArray<TabItem<FinanzasTab>> = [
  { value: 'reembolsos', label: 'Reembolsos', icon: Receipt },
  { value: 'horas', label: 'Horas extra', icon: Clock },
  { value: 'liquidaciones', label: 'Liquidaciones', icon: FileText },
];

/**
 * Página Finanzas (§6-3.1 Reembolsos / §6-3.3 Horas extra / §6-3.4 Liquidaciones).
 *
 * Cáscara del módulo: header + toggle de pestañas. La pestaña activa vive en la
 * URL (`/finanzas/:tab`, mismo patrón que Operaciones) para que los links de las
 * notificaciones (`/finanzas/reembolsos`, `/finanzas/horas`) aterricen en la
 * pestaña correcta. El contenido de cada pestaña (lista propia, formulario de
 * solicitud y, para gestores, la lista global con acciones) vive en su
 * respectivo componente Tab. El gating de gestión es un probe silencioso dentro
 * de los hooks, no se decide por rol aquí.
 */
export default function FinanzasPage(): ReactNode {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // Valida el segmento de la URL; cualquier otro valor cae a Reembolsos.
  const activeTab: FinanzasTab =
    tab === 'reembolsos' || tab === 'horas' || tab === 'liquidaciones' ? tab : 'reembolsos';

  const handleTabChange = (newTab: FinanzasTab): void => {
    navigate(`/finanzas/${newTab}`);
  };

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Finanzas"
        description="Reembolsos, horas extra y liquidaciones de sueldo."
      />
      <Tabs
        items={FINANZAS_TABS}
        value={activeTab}
        onValueChange={handleTabChange}
        aria-label="Secciones de finanzas"
      />

      {activeTab === 'reembolsos' && <ReembolsosTab />}
      {activeTab === 'horas' && <HorasExtraTab />}
      {activeTab === 'liquidaciones' && <LiquidacionesTab />}
    </PageContainer>
  );
}
