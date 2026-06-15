import { useState, type ReactNode } from 'react';
import { OperacionesTabs, type OperacionesTab } from './operaciones-tabs';
import { ProyectosTab } from './proyectos';
import { BacklogTab } from './backlog';
import { DocumentosTab } from './documentos';

export default function OperacionesPage(): ReactNode {
  const [tab, setTab] = useState<OperacionesTab>('proyectos');

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operaciones</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de proyectos, backlog Kanban y documentos técnicos aprobados.
          </p>
        </div>
        <OperacionesTabs active={tab} onChange={setTab} />
      </header>

      {tab === 'proyectos' && <ProyectosTab />}
      {tab === 'backlog' && <BacklogTab />}
      {tab === 'documentos' && <DocumentosTab />}
    </div>
  );
}
