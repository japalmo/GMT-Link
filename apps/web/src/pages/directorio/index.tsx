import { useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import type { DirectoryEntry } from '@gtm-link/shared-types';
import { Button } from '@/components/ui/button';
import {
  RoleScopedList,
  type RoleScopedColumn,
  type RoleScopedFilter,
} from '@/components/primitives/role-scoped-list';
import { useDirectory } from '@/hooks/use-directory';
import { RoleChips } from '@/pages/usuarios/role-chips';
import { PersonAvatar } from './person-avatar';
import { TypeBadge } from './type-badge';
import { DirectoryDetailDialog } from './directory-detail-dialog';

/**
 * Página de Directorio (§6-1.6).
 *
 * Ensambla la primitiva `RoleScopedList` (§5) sobre las entradas que el backend
 * deja visibles (scoping por permisos en servidor). La búsqueda es client-side.
 * Cada fila abre un diálogo de detalle que carga el básico y, si hay permiso, el
 * extendido (status / puntos / segundos nombres). Estados vacío/carga/error.
 */
export default function DirectorioPage(): ReactNode {
  const { entries, loading, error, refetch } = useDirectory();
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);

  const columns: ReadonlyArray<RoleScopedColumn<DirectoryEntry>> = [
    {
      id: 'persona',
      header: 'Persona',
      sortable: true,
      accessor: (e) => `${e.firstName} ${e.lastName}`,
      render: (e) => (
        <div className="flex items-center gap-3">
          <PersonAvatar
            firstName={e.firstName}
            lastName={e.lastName}
            avatarUrl={e.avatarUrl}
          />
          <span className="font-medium">
            {e.firstName} {e.lastName}
          </span>
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Correo',
      sortable: true,
      accessor: (e) => e.email,
      render: (e) => <span className="text-muted-foreground">{e.email}</span>,
    },
    {
      id: 'roles',
      header: 'Roles',
      render: (e) => <RoleChips roleKeys={e.roleKeys} />,
    },
    {
      id: 'tipo',
      header: 'Tipo',
      render: (e) => <TypeBadge isClientUser={e.isClientUser} />,
    },
  ];

  const filters: ReadonlyArray<RoleScopedFilter<DirectoryEntry>> = [
    {
      id: 'tipo',
      label: 'Tipo',
      options: [
        { value: 'colaborador', label: 'Colaborador' },
        { value: 'cliente', label: 'Cliente' },
      ],
      predicate: (e, value) =>
        value === 'cliente' ? e.isClientUser : !e.isClientUser,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Directorio</h1>
        <p className="text-sm text-muted-foreground">
          Encuentra a colaboradores y clientes, y abre su detalle.
        </p>
      </header>

      <RoleScopedList<DirectoryEntry>
        items={entries}
        columns={columns}
        getRowId={(e) => e.id}
        searchable
        searchPlaceholder="Buscar por nombre o correo…"
        filters={filters}
        loading={loading}
        error={error}
        onRetry={() => void refetch()}
        emptyMessage="No hay personas para mostrar."
        rowActionsLabel="Acciones"
        rowActions={(e) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelected(e)}
            aria-label={`Ver detalle de ${e.firstName} ${e.lastName}`}
          >
            <Eye aria-hidden />
            Ver
          </Button>
        )}
        caption="Directorio de personas"
      />

      <DirectoryDetailDialog
        entryId={selected?.id ?? null}
        fallbackEntry={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
