import { useState, type ReactNode } from 'react';
import { Plus, Upload, UserCog, TriangleAlert, X } from 'lucide-react';
import type { RoleKey } from '@gtm-link/shared-types';
import { Button } from '@/components/ui/button';
import { RoleScopedList, type RoleScopedColumn } from '@/components/primitives/role-scoped-list';
import { useUsers } from '@/hooks/use-users';
import type { CreateUserDto, ImportUsersResponse, UserListItem } from '@/lib/api';
import { RoleChips } from './role-chips';
import { StatusBadge } from './status-badge';
import { NewUserDialog } from './new-user-dialog';
import { ImportUsersDialog } from './import-users-dialog';
import { RolesDialog } from './roles-dialog';
import { CredentialDialog, type ProvisionalCredential } from './credential-dialog';

/** Fecha corta es-CL a partir de un ISO string. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-CL');
}

/**
 * Página de administración de Usuarios (§6-1.1). Ensambla la primitiva
 * `RoleScopedList` (§5) para el directorio y orquesta los diálogos de creación,
 * importación CSV y gestión de roles. La clave provisoria se muestra una sola vez
 * tras crear/importar (decisión §9: sin email).
 */
export default function UsuariosPage(): ReactNode {
  const { users, loading, error, refetch, create, importRows, assignRole, removeRole } = useUsers();

  const [newUserOpen, setNewUserOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [rolesUser, setRolesUser] = useState<UserListItem | null>(null);
  const [credentials, setCredentials] = useState<readonly ProvisionalCredential[] | null>(null);
  const [credentialsTitle, setCredentialsTitle] = useState('Credencial provisoria');
  const [importErrors, setImportErrors] = useState<ImportUsersResponse['errors']>([]);

  async function handleCreate(dto: CreateUserDto): Promise<void> {
    const res = await create(dto);
    setCredentialsTitle('Credencial provisoria');
    setCredentials([
      { email: res.user.email, provisionalPassword: res.provisionalPassword },
    ]);
    await refetch();
  }

  function handleImported(result: ImportUsersResponse): void {
    setImportOpen(false);
    setImportErrors(result.errors);
    if (result.created.length > 0) {
      setCredentialsTitle(`${result.created.length} usuario(s) importado(s)`);
      setCredentials(
        result.created.map((c) => ({ email: c.email, provisionalPassword: c.provisionalPassword })),
      );
    }
    void refetch();
  }

  const columns: ReadonlyArray<RoleScopedColumn<UserListItem>> = [
    {
      id: 'nombre',
      header: 'Nombre',
      sortable: true,
      accessor: (u) => `${u.firstName} ${u.lastName}`,
      render: (u) => (
        <span className="font-medium">
          {u.firstName} {u.lastName}
        </span>
      ),
    },
    {
      id: 'email',
      header: 'Correo',
      sortable: true,
      accessor: (u) => u.email,
      render: (u) => <span className="text-muted-foreground">{u.email}</span>,
    },
    {
      id: 'roles',
      header: 'Roles',
      render: (u) => <RoleChips roleKeys={u.roleKeys} />,
    },
    {
      id: 'estado',
      header: 'Estado',
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      id: 'creado',
      header: 'Creado',
      sortable: true,
      accessor: (u) => u.createdAt,
      render: (u) => <span className="text-sm text-muted-foreground">{formatDate(u.createdAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
          <p className="text-sm text-muted-foreground">
            Provisiona colaboradores y clientes, y gestiona sus roles.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden />
            Importar CSV
          </Button>
          <Button onClick={() => setNewUserOpen(true)}>
            <Plus aria-hidden />
            Nuevo usuario
          </Button>
        </div>
      </header>

      {importErrors.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4" aria-hidden />
              {importErrors.length} fila(s) no se importaron
            </span>
            <button
              type="button"
              onClick={() => setImportErrors([])}
              aria-label="Descartar errores de importación"
              className="rounded p-0.5 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {importErrors.map((err, i) => (
              <li key={`${err.index}-${i}`}>
                Fila {err.index + 1}
                {err.email ? ` (${err.email})` : ''}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <RoleScopedList<UserListItem>
        items={users}
        columns={columns}
        getRowId={(u) => u.id}
        searchable
        searchPlaceholder="Buscar por nombre o correo…"
        loading={loading}
        error={error}
        onRetry={() => void refetch()}
        emptyMessage="No hay usuarios todavía. Crea el primero o importa un CSV."
        rowActionsLabel="Acciones"
        rowActions={(u) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRolesUser(u)}
            aria-label={`Gestionar roles de ${u.firstName} ${u.lastName}`}
          >
            <UserCog aria-hidden />
            Roles
          </Button>
        )}
        caption="Directorio de usuarios"
      />

      <NewUserDialog open={newUserOpen} onOpenChange={setNewUserOpen} onCreate={handleCreate} />

      <ImportUsersDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(rows: CreateUserDto[]) => importRows(rows)}
        onImported={handleImported}
      />

      <RolesDialog
        user={rolesUser}
        onOpenChange={(open) => (open ? undefined : setRolesUser(null))}
        onAssign={(id, roleKey: RoleKey) => assignRole(id, roleKey)}
        onRemove={(id, roleKey: RoleKey) => removeRole(id, roleKey)}
        onChanged={() => void refetch()}
      />

      <CredentialDialog
        open={credentials !== null}
        onOpenChange={(open) => (open ? undefined : setCredentials(null))}
        credentials={credentials ?? []}
        title={credentialsTitle}
      />
    </div>
  );
}
