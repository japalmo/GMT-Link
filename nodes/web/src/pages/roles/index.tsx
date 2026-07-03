import { useState, type ReactNode } from 'react';
import { Plus, Lock } from 'lucide-react';
import type { RoleDetail } from '@gmt-platform/contracts';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRoles } from '@/hooks/use-roles';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import { RoleEditor } from './role-editor';
import { NewRoleDialog } from './new-role-dialog';

function RoleRow({
  role,
  active,
  onSelect,
}: {
  role: RoleDetail;
  active: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ' +
        (active ? 'bg-primary/10 text-primary' : 'hover:bg-accent')
      }
    >
      <span className="truncate">{role.label}</span>
      {role.isSystem && <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
}

/**
 * Página de administración de Roles (§Fase 5 — matriz RBAC). Ensambla
 * `useRoles` + `RoleEditor`: a la izquierda la lista separada en "Del
 * sistema" (candado, solo lectura + clonar) y "Personalizados" (CRUD); a la
 * derecha el editor del rol seleccionado. Gateada en el nav por
 * `canManageRoles`.
 */
export default function RolesPage(): ReactNode {
  const { catalog, systemRoles, customRoles, loading, error, refetch, getRole, createRole, updateRole, deleteRole, cloneRole } =
    useRoles();
  const [selected, setSelected] = useState<RoleDetail | null>(null);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<RoleDetail | null>(null);

  async function selectRole(key: string): Promise<void> {
    try {
      const detail = await getRole(key);
      setSelected(detail);
    } catch {
      toast.error('No se pudo cargar el rol.');
    }
  }

  async function handleSave(key: string, input: Parameters<typeof updateRole>[1]): Promise<void> {
    const updated = await updateRole(key, input);
    setSelected(updated);
    toast.success('Rol actualizado.');
  }

  async function handleClone(key: string): Promise<void> {
    const source = [...systemRoles, ...customRoles].find((r) => r.key === key);
    const label = source ? `${source.label} (copia)` : 'Copia de rol';
    try {
      // A7: el backend filtra los grants NO componibles al clonar y los reporta.
      const { role: cloned, omittedPermissionKeys } = await cloneRole(key, label);
      setSelected(cloned);
      if (omittedPermissionKeys.length > 0) {
        toast.warning(
          `Rol clonado sin ${omittedPermissionKeys.length} permiso(s) no componible(s): ${omittedPermissionKeys.join(', ')}.`,
        );
      } else {
        toast.success('Rol clonado. Ya puedes editarlo.');
      }
    } catch {
      toast.error('No se pudo clonar el rol.');
    }
  }

  async function handleCreate(label: string): Promise<void> {
    // A6: grants: [] es un body válido (DTO sin ArrayMinSize) — flujo crear→editar:
    // se crea el rol vacío y se abre el editor para componer sus permisos.
    const created = await createRole({ label, grants: [] });
    setSelected(created);
  }

  /**
   * Borrado confirmado (destructivo). El `ConfirmDialog` corre esto: si
   * `deleteRole` lanza (p. ej. 409 ROLE_IN_USE), el diálogo muestra el error
   * inline y NO cierra; si resuelve, cierra y limpia la selección.
   */
  async function confirmDelete(): Promise<void> {
    if (!roleToDelete) return;
    const key = roleToDelete.key;
    await deleteRole(key);
    if (selected?.key === key) setSelected(null);
    toast.success('Rol eliminado.');
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6" role="status" aria-label="Cargando roles">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground">
            Crea roles a medida componiendo permisos del catálogo por módulo.
          </p>
        </div>
        <Button onClick={() => setNewRoleOpen(true)}>
          <Plus aria-hidden />
          Nuevo rol
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-4">
          <div>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Del sistema
            </p>
            <div className="flex flex-col gap-0.5">
              {systemRoles.map((r) => (
                <RoleRow key={r.key} role={r} active={selected?.key === r.key} onSelect={() => void selectRole(r.key)} />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Personalizados
            </p>
            {customRoles.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">
                No hay roles personalizados todavía. Crea el primero.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {customRoles.map((r) => (
                  <div key={r.key} className="flex items-center gap-1">
                    <div className="flex-1">
                      <RoleRow role={r} active={selected?.key === r.key} onSelect={() => void selectRole(r.key)} />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Eliminar rol ${r.label}`}
                      onClick={() => setRoleToDelete(r)}
                    >
                      Eliminar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section>
          {selected ? (
            <RoleEditor role={selected} catalog={catalog} onSave={handleSave} onClone={handleClone} />
          ) : (
            <p className="text-sm text-muted-foreground">Selecciona un rol para ver o editar sus permisos.</p>
          )}
        </section>
      </div>

      <NewRoleDialog open={newRoleOpen} onOpenChange={setNewRoleOpen} onCreate={handleCreate} />

      <ConfirmDialog
        open={roleToDelete !== null}
        onOpenChange={(open) => !open && setRoleToDelete(null)}
        title="¿Eliminar rol?"
        description={
          roleToDelete ? (
            <>
              Se eliminará el rol <strong>{roleToDelete.label}</strong> de forma permanente. Si
              algún usuario lo tiene asignado, primero deberás quitárselo.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Eliminar rol"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
