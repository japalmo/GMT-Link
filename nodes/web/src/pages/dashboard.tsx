import { type ReactNode } from 'react';
import { useAuth } from '@/context/auth-context';
import { TareasResumenWidget } from '@/pages/dashboard/widgets/tareas-resumen-widget';

export default function DashboardPage(): ReactNode {
  const { user } = useAuth();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Inicio</p>
          <h1 className="text-2xl font-bold tracking-tight">
            Hola{user ? `, ${user.firstName}` : ''}.
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Resumen general de tareas y actividades en curso.
          </p>
        </div>
      </header>

      <div className="max-w-4xl">
        <TareasResumenWidget />
      </div>
    </div>
  );
}

