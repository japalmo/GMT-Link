import { useId, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Kanban, Files, LifeBuoy } from 'lucide-react';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { useHasPermission } from '@/hooks/use-has-permission';
import { EmptyState } from '@/components/ui/states';
import { BacklogTab } from './backlog';
import { DocumentosTab } from './documentos';
import { MisSolicitudesTab } from './mis-solicitudes';

/** Pestaña activa del módulo Operaciones. */
export type OperacionesTab = 'backlog' | 'documentos' | 'mis-solicitudes';

export default function OperacionesPage(): ReactNode {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const idBase = useId();

  // Gating POR PESTAÑA. Operaciones ahora se enciende con dos permisos distintos:
  // `task:read` (backlog y documentos) y `ticket:create` (solicitudes a TI). Sin
  // esto, alguien de RH que entra solo a pedir vería el Backlog del área de
  // operaciones, y alguien de terreno vería una pestaña que no le sirve.
  const puedeOperar = useHasPermission('task:read');
  const puedePedir = useHasPermission('ticket:create');

  const tabs = useMemo<ReadonlyArray<TabItem<OperacionesTab>>>(() => {
    const items: Array<TabItem<OperacionesTab>> = [];
    if (puedeOperar) {
      items.push({ value: 'backlog', label: 'Backlog (Kanban)', icon: Kanban });
      items.push({ value: 'documentos', label: 'Documentos', icon: Files });
    }
    if (puedePedir) {
      items.push({ value: 'mis-solicitudes', label: 'Mis solicitudes', icon: LifeBuoy });
    }
    return items;
  }, [puedeOperar, puedePedir]);

  // La sección de Proyectos migró a su propio módulo `/proyectos` (jerarquía
  // A0 Cliente → Faena → Proyecto). Redirigimos el enlace legacy.
  if (tab === 'proyectos') {
    return <Navigate to="/proyectos" replace />;
  }

  // La pestaña por defecto es la PRIMERA que el usuario puede ver, no siempre el
  // backlog: quien entra solo a pedir aterriza en sus solicitudes.
  const primera = tabs[0]?.value;
  const pedida = tabs.find((t) => t.value === tab)?.value;
  const activeTab = pedida ?? primera;

  const handleTabChange = (newTab: OperacionesTab): void => {
    navigate(`/operaciones/${newTab}`);
  };

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Operaciones"
        description="Backlog Kanban, documentos técnicos y solicitudes al área de Informática."
      />

      {activeTab === undefined ? (
        <EmptyState
          title="No tienes acceso a ninguna sección de Operaciones"
          message="Si necesitas entrar, pídelo a través de tu jefatura."
        />
      ) : (
        <>
          <Tabs
            items={tabs}
            value={activeTab}
            onValueChange={handleTabChange}
            aria-label="Secciones de operaciones"
            idBase={idBase}
          />

          <TabPanel idBase={idBase} value={activeTab}>
            {activeTab === 'backlog' && <BacklogTab />}
            {activeTab === 'documentos' && <DocumentosTab />}
            {activeTab === 'mis-solicitudes' && <MisSolicitudesTab />}
          </TabPanel>
        </>
      )}
    </PageContainer>
  );
}
