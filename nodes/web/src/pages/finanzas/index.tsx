import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Clock, Receipt, FileText } from 'lucide-react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { useHasPermission } from '@/hooks/use-has-permission';
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
 * respectivo componente Tab. Reembolsos y Horas extra son visibles para todos y
 * su gestión interna se resuelve con un probe silencioso dentro de los hooks.
 * Liquidaciones, en cambio, es una sección manager-only: su pestaña se gatea por
 * rol aquí (mismo criterio que el guard `can_manage_finance` del backend) y el
 * acceso directo a `/finanzas/liquidaciones` sin permiso redirige.
 */
export default function FinanzasPage(): ReactNode {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // Liquidaciones es gestión (manager-only): sólo visible para quien puede ver
  // todas las solicitudes de finanzas. Horas extra y Reembolsos siguen visibles
  // para todos. `useHasPermission` es fail-closed mientras la sesión carga
  // (devuelve `false`), así la pestaña no parpadea para el rol por defecto (worker).
  const canManageFinance = useHasPermission('finance:request:view:all');

  // Pestañas visibles según permiso: liquidaciones se filtra si no es gestor.
  const visibleTabs = FINANZAS_TABS.filter(
    (item) => item.value !== 'liquidaciones' || canManageFinance,
  );

  // Valida el segmento de la URL; cualquier otro valor cae a Reembolsos.
  const activeTab: FinanzasTab =
    tab === 'reembolsos' || tab === 'horas' || tab === 'liquidaciones' ? tab : 'reembolsos';

  // Acceso directo a `/finanzas/liquidaciones` sin permiso → redirige a la
  // primera pestaña permitida (Reembolsos, siempre visible).
  if (activeTab === 'liquidaciones' && !canManageFinance) {
    return <Navigate to="/finanzas/reembolsos" replace />;
  }

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
        items={visibleTabs}
        value={activeTab}
        onValueChange={handleTabChange}
        aria-label="Secciones de finanzas"
      />

      {activeTab === 'reembolsos' && <ReembolsosTab />}
      {activeTab === 'horas' && <HorasExtraTab />}
      {activeTab === 'liquidaciones' && canManageFinance && <LiquidacionesTab />}
    </PageContainer>
  );
}
