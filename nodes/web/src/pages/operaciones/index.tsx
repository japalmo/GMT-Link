import { type ReactNode } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Kanban, Files } from 'lucide-react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { BacklogTab } from './backlog';
import { DocumentosTab } from './documentos';

/** Pestaña activa del módulo Operaciones. */
export type OperacionesTab = 'backlog' | 'documentos';

/** Definición de las pestañas de Operaciones (valor, etiqueta e icono). */
const OPERACIONES_TABS: ReadonlyArray<TabItem<OperacionesTab>> = [
  { value: 'backlog', label: 'Backlog (Kanban)', icon: Kanban },
  { value: 'documentos', label: 'Documentos', icon: Files },
];

export default function OperacionesPage(): ReactNode {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // La sección de Proyectos migró a su propio módulo `/proyectos` (jerarquía
  // A0 Cliente → Faena → Proyecto). Redirigimos el enlace legacy.
  if (tab === 'proyectos') {
    return <Navigate to="/proyectos" replace />;
  }

  // Validate the tab parameter, fallback to 'backlog'
  const activeTab: OperacionesTab = tab === 'documentos' ? 'documentos' : 'backlog';

  const handleTabChange = (newTab: OperacionesTab): void => {
    navigate(`/operaciones/${newTab}`);
  };

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Operaciones"
        description="Backlog Kanban y documentos técnicos aprobados."
      />
      <Tabs
        items={OPERACIONES_TABS}
        value={activeTab}
        onValueChange={handleTabChange}
        aria-label="Secciones de operaciones"
      />

      {activeTab === 'backlog' && <BacklogTab />}
      {activeTab === 'documentos' && <DocumentosTab />}
    </PageContainer>
  );
}
