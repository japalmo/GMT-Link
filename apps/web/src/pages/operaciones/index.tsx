import { type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { OperacionesTabs, type OperacionesTab } from './operaciones-tabs';
import { ProyectosTab } from './proyectos';
import { BacklogTab } from './backlog';
import { DocumentosTab } from './documentos';

export default function OperacionesPage(): ReactNode {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // Validate the tab parameter, fallback to 'proyectos'
  const activeTab: OperacionesTab = (tab === 'proyectos' || tab === 'backlog' || tab === 'documentos')
    ? tab
    : 'proyectos';

  const handleTabChange = (newTab: OperacionesTab) => {
    navigate(`/operaciones/${newTab}`);
  };

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operaciones</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de proyectos, backlog Kanban y documentos técnicos aprobados.
          </p>
        </div>
        <OperacionesTabs active={activeTab} onChange={handleTabChange} />
      </header>

      {activeTab === 'proyectos' && <ProyectosTab />}
      {activeTab === 'backlog' && <BacklogTab />}
      {activeTab === 'documentos' && <DocumentosTab />}
    </div>
  );
}

