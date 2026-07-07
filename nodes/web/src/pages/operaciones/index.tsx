import { type ReactNode } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { OperacionesTabs, type OperacionesTab } from './operaciones-tabs';
import { BacklogTab } from './backlog';
import { DocumentosTab } from './documentos';

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

  const handleTabChange = (newTab: OperacionesTab) => {
    navigate(`/operaciones/${newTab}`);
  };

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operaciones</h1>
          <p className="text-sm text-muted-foreground">
            Backlog Kanban y documentos técnicos aprobados.
          </p>
        </div>
        <OperacionesTabs active={activeTab} onChange={handleTabChange} />
      </header>

      {activeTab === 'backlog' && <BacklogTab />}
      {activeTab === 'documentos' && <DocumentosTab />}
    </div>
  );
}

