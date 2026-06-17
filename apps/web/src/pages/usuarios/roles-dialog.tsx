import { useEffect, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { ROLE_KEYS, type RoleKey } from '@gmt-link/shared-types';
import { Modal, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import type { UserListItem, UserRolesResponse } from '@/lib/api';
import { roleLabel } from '@/lib/role-labels';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';

/**
 * Diálogo de gestión de roles por defecto de un usuario (§1.1). Lista los roles
 * actuales (quitar) y permite agregar uno de los faltantes. Cada acción llama al
 * backend y actualiza el estado local; al cerrar notifica al padre para refrescar.
 */
export function RolesDialog({
  user,
  onOpenChange,
  onAssign,
  onRemove,
  onChanged,
}: {
  user: UserListItem | null;
  onOpenChange: (open: boolean) => void;
  onAssign: (id: string, roleKey: RoleKey) => Promise<UserRolesResponse>;
  onRemove: (id: string, roleKey: RoleKey) => Promise<UserRolesResponse>;
  onChanged: () => void;
}): ReactNode {
  const [roles, setRoles] = useState<RoleKey[]>([]);
  const [toAdd, setToAdd] = useState<RoleKey | ''>('');
  const [roleToRemove, setRoleToRemove] = useState<RoleKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setRoles(user ? [...user.roleKeys] : []);
    setToAdd('');
    setRoleToRemove(null);
    setError(null);
    setDirty(false);
  }, [user]);

  const available = ROLE_KEYS.filter((r) => !roles.includes(r));

  async function add(): Promise<void> {
    if (!user || toAdd === '') return;
    setBusy(true);
    setError(null);
    try {
      const res = await onAssign(user.id, toAdd);
      setRoles(res.roleKeys);
      setToAdd('');
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asignar el rol.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: RoleKey): Promise<void> {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onRemove(user.id, role);
      setRoles(res.roleKeys);
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el rol.');
      throw err; // propagates to ConfirmDialog
    } finally {
      setBusy(false);
    }
  }

  function close(): void {
    if (dirty) onChanged();
    onOpenChange(false);
  }

  return (
    <>
      <Modal open={user !== null} onOpenChange={(next) => (next ? undefined : close())}>
        <ModalContent className="sm:max-w-md">
          <ModalHeader>
            <ModalTitle>Roles de {user ? `${user.firstName} ${user.lastName}` : ''}</ModalTitle>
            <ModalDescription>
              Roles por defecto del usuario. Se aplican al asignarlo a un proyecto.
            </ModalDescription>
          </ModalHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {roles.length === 0 && (
                <span className="text-sm text-muted-foreground">Sin roles asignados.</span>
              )}
              {roles.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs font-medium text-secondary-foreground"
                >
                  {roleLabel(role)}
                  <button
                    type="button"
                    onClick={() => setRoleToRemove(role)}
                    disabled={busy}
                    aria-label={`Quitar rol ${roleLabel(role)}`}
                    className="rounded-full p-0.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-sm font-medium leading-none">Agregar rol</span>
                <select
                  value={toAdd}
                  onChange={(e) => setToAdd(e.target.value as RoleKey | '')}
                  disabled={busy || available.length === 0}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <option value="">
                    {available.length === 0 ? 'Sin roles disponibles' : 'Selecciona un rol…'}
                  </option>
                  {available.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" onClick={() => void add()} disabled={busy || toAdd === ''}>
                <Plus aria-hidden />
                Agregar
              </Button>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <ModalFooter>
            <Button type="button" onClick={close} disabled={busy}>
              Listo
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={roleToRemove !== null}
        onOpenChange={(open) => !open && setRoleToRemove(null)}
        title="¿Quitar rol?"
        description={
          roleToRemove ? (
            <>
              ¿Seguro que deseas quitar el rol <strong>{roleLabel(roleToRemove)}</strong> a{' '}
              <strong>{user ? `${user.firstName} ${user.lastName}` : ''}</strong>?
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Quitar rol"
        onConfirm={async () => {
          if (roleToRemove) {
            await remove(roleToRemove);
          }
        }}
      />
    </>
  );
}
