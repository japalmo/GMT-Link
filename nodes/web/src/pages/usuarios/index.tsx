import { useState, type ReactNode } from 'react';
import { Plus, Upload, UserCog, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { RoleScopedList, type RoleScopedColumn } from '@/components/primitives/role-scoped-list';
import { useUsers } from '@/hooks/use-users';
import type { CreateUserDto, ImportUsersResponse, UserListItem } from '@/lib/api';
import { uploadUserAvatar } from '@/lib/api';
import { toast } from 'sonner';
import { RoleChips } from './role-chips';
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

  async function handleCreate(dto: CreateUserDto, avatarFile: File | null): Promise<void> {
    const res = await create(dto);
    if (avatarFile) {
      try {
        await uploadUserAvatar(res.user.id, avatarFile);
      } catch {
        toast.error('El usuario se creó, pero no se pudo subir su foto de perfil.');
      }
    }
    setCredentialsTitle('Credencial provisoria');
    setCredentials([
      { username: res.user.username, email: res.user.email, provisionalPassword: res.provisionalPassword },
    ]);
    await refetch();
  }

  function handleImported(result: ImportUsersResponse): void {
    setImportOpen(false);
    setImportErrors(result.errors);
    if (result.created.length > 0) {
      setCredentialsTitle(`${result.created.length} usuario(s) importado(s)`);
      setCredentials(
        result.created.map((c) => ({ username: c.username, email: c.email, provisionalPassword: c.provisionalPassword })),
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
      id: 'usuario',
      header: 'Usuario',
      sortable: true,
      accessor: (u) => u.username,
      render: (u) => <span className="font-medium">{u.username}</span>,
    },
    {
      id: 'email',
      header: 'Email',
      sortable: true,
      accessor: (u) => u.emailInstitucional ?? u.emailPersonal ?? u.email,
      render: (u) => (
        <span className="text-muted-foreground">
          {u.emailInstitucional ?? u.emailPersonal ?? u.email}
        </span>
      ),
    },
    {
      id: 'roles',
      header: 'Roles',
      render: (u) => <RoleChips memberships={u.memberships} />,
    },
    {
      id: 'estado',
      header: 'Estado',
      render: (u) => <StatusBadge type="user" status={u.status} />,
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
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Usuarios"
        description="Provisiona colaboradores y clientes, y gestiona sus roles."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden />
              Importar CSV
            </Button>
            <Button onClick={() => setNewUserOpen(true)}>
              <Plus aria-hidden />
              Nuevo usuario
            </Button>
          </>
        }
      />

      {importErrors.length > 0 && (
        <Alert variant="warning" live>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {importErrors.length} fila(s) no se importaron
              </span>
              <button
                type="button"
                onClick={() => setImportErrors([])}
                aria-label="Descartar errores de importación"
                className="rounded p-0.5 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
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
        </Alert>
      )}

      <RoleScopedList<UserListItem>
        items={users}
        columns={columns}
        getRowId={(u) => u.id}
        searchable
        searchPlaceholder="Buscar por nombre, usuario o email…"
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
        onAssign={(id, input) => assignRole(id, input)}
        onRemove={(id, membership) => removeRole(id, membership)}
        onChanged={() => void refetch()}
      />

      <CredentialDialog
        open={credentials !== null}
        onOpenChange={(open) => (open ? undefined : setCredentials(null))}
        credentials={credentials ?? []}
        title={credentialsTitle}
      />
    </PageContainer>
  );
}
