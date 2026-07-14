import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Ban, KeyRound, LogOut, Plus, ShieldCheck, Upload, UserCog, Users, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
} from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/context/auth-context';
import type { AssignRoleInput, TableRequest, UserMembership } from '@gmt-platform/contracts';
import {
  assignUserRole,
  createUser,
  fetchUsersTable,
  importUsers,
  removeUserRole,
  revokeUserInvite,
  revokeUserSessions,
  uploadUserAvatar,
  type CreateUserDto,
  type ImportUsersResponse,
  type UserListItem,
} from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import RolesPage from '@/pages/roles';
import { RoleChips } from './role-chips';
import { NewUserDialog } from './new-user-dialog';
import { ImportUsersDialog } from './import-users-dialog';
import { RolesDialog } from './roles-dialog';
import { CredentialDialog, type ProvisionalCredential } from './credential-dialog';
import { UserDetailDialog } from './user-detail-dialog';
import { ResendClaveDialog } from './resend-clave-dialog';

/** Pestaña activa de la página de Usuarios. */
type UsuariosTab = 'usuarios' | 'roles';

/** Opciones del filtro por estado (server-side). */
const STATUS_FILTER: DataTableFilter = {
  id: 'status',
  label: 'Estado',
  allLabel: 'Todos los estados',
  options: [
    { value: 'ACTIVE', label: 'Activo' },
    { value: 'PENDING_FIRST_LOGIN', label: 'Pendiente' },
    { value: 'SUSPENDED', label: 'Suspendido' },
  ],
};

/** Opciones del filtro por tipo (interno / cliente). */
const TIPO_FILTER: DataTableFilter = {
  id: 'tipo',
  label: 'Tipo',
  allLabel: 'Todos',
  options: [
    { value: 'interno', label: 'Internos' },
    { value: 'cliente', label: 'Clientes (ITO)' },
  ],
};

/** Fecha corta es-CL a partir de un ISO string. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-CL');
}

/**
 * Pestaña "Usuarios" (§6-1.1). Ensambla el MOTOR de tablas unificado
 * (`useDataTable` + `DataTable`, server-side offset): búsqueda, filtro por
 * estado/tipo y orden se resuelven en el servidor sobre TODOS los usuarios, con
 * páginas numeradas y selector de filas por página. La fila es clickeable y abre
 * el detalle editable (o borrar); los botones de acción gestionan roles, reenvío
 * de clave (con vista previa editable del correo), revocación y cierre de sesiones.
 */
function UsuariosDirectorioTab(): ReactNode {
  const fetcher = useCallback((req: TableRequest) => fetchUsersTable(req), []);
  const table = useDataTable<UserListItem>(fetcher, {
    initialPageSize: 10,
    initialSortBy: 'creado',
    initialSortDir: 'desc',
  });

  const [newUserOpen, setNewUserOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [rolesUser, setRolesUser] = useState<UserListItem | null>(null);
  const [revokeUser, setRevokeUser] = useState<UserListItem | null>(null);
  const [sessionsUser, setSessionsUser] = useState<UserListItem | null>(null);
  const [detailUser, setDetailUser] = useState<UserListItem | null>(null);
  const [resendUser, setResendUser] = useState<UserListItem | null>(null);
  const [credentials, setCredentials] = useState<readonly ProvisionalCredential[] | null>(null);
  const [credentialsTitle, setCredentialsTitle] = useState('Credencial provisoria');
  const [importErrors, setImportErrors] = useState<ImportUsersResponse['errors']>([]);

  async function handleCreate(dto: CreateUserDto, avatarFile: File | null): Promise<void> {
    const res = await createUser(dto);
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
    table.refetch();
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
    table.refetch();
  }

  const columns: ReadonlyArray<DataTableColumn<UserListItem>> = [
    {
      id: 'nombre',
      header: 'Nombre',
      sortable: true,
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
      render: (u) => <span className="font-medium">{u.username}</span>,
    },
    {
      id: 'email',
      header: 'Email',
      sortable: true,
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
      sortable: true,
      render: (u) => <StatusBadge type="user" status={u.status} />,
    },
    {
      id: 'creado',
      header: 'Creado',
      sortable: true,
      render: (u) => <span className="text-sm text-muted-foreground">{formatDate(u.createdAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Acciones del directorio: viven en el panel de la pestaña. */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload aria-hidden />
          Importar CSV
        </Button>
        <Button onClick={() => setNewUserOpen(true)}>
          <Plus aria-hidden />
          Nuevo usuario
        </Button>
      </div>

      {importErrors.length > 0 && (
        <Alert variant="warning" live>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{importErrors.length} fila(s) no se importaron</span>
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

      <DataTable<UserListItem>
        table={table}
        columns={columns}
        getRowId={(u) => u.id}
        searchable
        searchPlaceholder="Buscar por nombre, usuario o email…"
        filters={[STATUS_FILTER, TIPO_FILTER]}
        onRowClick={(u) => setDetailUser(u)}
        emptyMessage="No hay usuarios que coincidan. Crea el primero o importa un CSV."
        caption="Directorio de usuarios"
        rowActions={(u) => {
          // Solo PENDING_FIRST_LOGIN admite reenviar clave. Un usuario revocado
          // (SUSPENDED) NO reaparece aquí: re-otorgar acceso es una acción
          // explícita, no un efecto colateral del reenvío (ver assertInviteUnused).
          const invitePending = u.status === 'PENDING_FIRST_LOGIN';
          return (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRolesUser(u)}
                aria-label={`Gestionar roles de ${u.firstName} ${u.lastName}`}
              >
                <UserCog aria-hidden />
                Roles
              </Button>
              {invitePending && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResendUser(u)}
                  aria-label={`Reenviar clave de ${u.firstName} ${u.lastName}`}
                >
                  <KeyRound aria-hidden />
                  Reenviar clave
                </Button>
              )}
              {u.status !== 'SUSPENDED' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokeUser(u)}
                  aria-label={`Revocar acceso de ${u.firstName} ${u.lastName}`}
                >
                  <Ban aria-hidden />
                  Revocar acceso
                </Button>
              )}
              {u.status === 'ACTIVE' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSessionsUser(u)}
                  aria-label={`Cerrar sesiones de ${u.firstName} ${u.lastName}`}
                >
                  <LogOut aria-hidden />
                  Cerrar sesiones
                </Button>
              )}
            </>
          );
        }}
      />

      <NewUserDialog open={newUserOpen} onOpenChange={setNewUserOpen} onCreate={handleCreate} />

      <ImportUsersDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(rows: CreateUserDto[]) => importUsers(rows)}
        onImported={handleImported}
      />

      <RolesDialog
        user={rolesUser}
        onOpenChange={(open) => (open ? undefined : setRolesUser(null))}
        onAssign={(id: string, input: AssignRoleInput) => assignUserRole(id, input)}
        onRemove={(id: string, membership: UserMembership) => removeUserRole(id, membership)}
        onChanged={() => table.refetch()}
      />

      <UserDetailDialog
        user={detailUser}
        onOpenChange={(open) => (open ? undefined : setDetailUser(null))}
        onSaved={() => table.refetch()}
        onDeleted={() => table.refetch()}
      />

      <ResendClaveDialog
        user={resendUser}
        onOpenChange={(open) => (open ? undefined : setResendUser(null))}
        onSent={(to) => {
          toast.success(to ? `Correo enviado a ${to}.` : 'Correo enviado.');
          table.refetch();
        }}
        onManualCredential={(cred) => {
          setCredentialsTitle('Clave provisoria reenviada');
          setCredentials([cred]);
          table.refetch();
        }}
      />

      <CredentialDialog
        open={credentials !== null}
        onOpenChange={(open) => (open ? undefined : setCredentials(null))}
        credentials={credentials ?? []}
        title={credentialsTitle}
      />

      <ConfirmDialog
        open={revokeUser !== null}
        onOpenChange={(open) => (open ? undefined : setRevokeUser(null))}
        title="Revocar acceso"
        description="¿Revocas el acceso de este usuario? No podrá iniciar sesión."
        confirmLabel="Revocar acceso"
        onConfirm={async () => {
          if (!revokeUser) return;
          await revokeUserInvite(revokeUser.id);
          toast.success('Acceso revocado.');
          table.refetch();
        }}
      />

      <ConfirmDialog
        open={sessionsUser !== null}
        onOpenChange={(open) => (open ? undefined : setSessionsUser(null))}
        title="Cerrar sesiones"
        description="¿Cierras todas las sesiones de este usuario?"
        confirmLabel="Cerrar sesiones"
        onConfirm={async () => {
          if (!sessionsUser) return;
          await revokeUserSessions(sessionsUser.id);
          toast.success('Sesiones cerradas.');
          table.refetch();
        }}
      />
    </div>
  );
}

/**
 * Página de administración de Usuarios. Cáscara con dos pestañas (patrón de
 * Finanzas/Recursos): "Usuarios" (el directorio y sus diálogos) y "Roles" (la
 * matriz RBAC reutilizada de la página de Roles, embebida). La pestaña "Roles"
 * solo aparece cuando el usuario puede gestionar roles (`canManageRoles`).
 */
export default function UsuariosPage(): ReactNode {
  const { user } = useAuth();
  const canManageRoles = user?.canManageRoles ?? false;
  const [activeTab, setActiveTab] = useState<UsuariosTab>('usuarios');

  // Fail-closed: si el usuario no puede gestionar roles, no dejamos la pestaña
  // "Roles" activa (p. ej. si pierde el permiso estando en ella).
  useEffect(() => {
    if (!canManageRoles && activeTab === 'roles') {
      setActiveTab('usuarios');
    }
  }, [canManageRoles, activeTab]);

  const tabItems: ReadonlyArray<TabItem<UsuariosTab>> = [
    { value: 'usuarios', label: 'Usuarios', icon: Users },
    ...(canManageRoles
      ? ([{ value: 'roles', label: 'Roles', icon: ShieldCheck }] as const)
      : []),
  ];

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Usuarios"
        description="Provisiona colaboradores y clientes, y gestiona sus roles y permisos."
      />

      <Tabs<UsuariosTab>
        items={tabItems}
        value={activeTab}
        onValueChange={setActiveTab}
        aria-label="Secciones de usuarios"
      />

      <div className="mt-4">
        {activeTab === 'usuarios' && <UsuariosDirectorioTab />}
        {activeTab === 'roles' && canManageRoles && <RolesPage embedded />}
      </div>
    </PageContainer>
  );
}
