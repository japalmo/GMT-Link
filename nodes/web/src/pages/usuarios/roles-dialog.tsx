import { useEffect, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { AssignRoleInput, RoleDetail, ScopeType, UserMembership } from '@gmt-platform/contracts';
import { Modal, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { listProjects, listRoles, type UserListItem, type UserRolesResponse } from '@/lib/api';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';

/** Id del objeto organización (única org actual) — SOLO como default de asignación org. */
const ORG_SCOPE_ID = 'gmt';

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Diálogo de asignación de roles por alcance de un usuario (§Fase 5 — H13).
 * Los chips se renderizan POR MEMBERSHIP (rol + badge de alcance:
 * "Organización" / "P-001 — Proyecto Uno") a partir de `user.memberships`, y
 * quitar pasa el `{roleKey, scopeType, scopeId}` EXACTO de esa membership —
 * nada hardcodeado en el remove. El selector de alcance queda limitado a
 * `role.allowedScopeTypes` del rol elegido; si el alcance es `PROJECT` se
 * exige elegir un proyecto concreto antes de habilitar "Agregar".
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
  onAssign: (id: string, input: AssignRoleInput) => Promise<UserRolesResponse>;
  onRemove: (id: string, membership: UserMembership) => Promise<UserRolesResponse>;
  onChanged: () => void;
}): ReactNode {
  const [roles, setRoles] = useState<RoleDetail[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [memberships, setMemberships] = useState<UserMembership[]>([]);
  const [toAdd, setToAdd] = useState<string>('');
  const [scopeType, setScopeType] = useState<ScopeType | ''>('');
  const [scopeId, setScopeId] = useState<string>('');
  const [toRemove, setToRemove] = useState<UserMembership | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!user) return;
    void listRoles().then(setRoles);
    void listProjects().then((ps) => setProjects(ps.map((p) => ({ id: p.id, code: p.code, name: p.name }))));
  }, [user]);

  useEffect(() => {
    setMemberships(user ? [...user.memberships] : []);
    setToAdd('');
    setScopeType('');
    setScopeId('');
    setToRemove(null);
    setError(null);
    setDirty(false);
  }, [user]);

  const selectedRole = roles.find((r) => r.key === toAdd) ?? null;

  /**
   * Roles ofrecibles en "Agregar rol": se excluye un rol solo-organización que
   * el usuario ya tenga a nivel organización (no se puede volver a asignar la
   * misma membership). Los roles de proyecto siempre se ofrecen: pueden
   * aplicarse a otro proyecto distinto.
   */
  const assignableRoles = roles.filter((role) => {
    const orgOnly = role.allowedScopeTypes.length === 1 && role.allowedScopeTypes[0] === 'ORGANIZATION';
    if (!orgOnly) return true;
    return !memberships.some((m) => m.roleKey === role.key && m.scopeType === 'ORGANIZATION');
  });

  function roleLabelFor(key: string): string {
    return roles.find((r) => r.key === key)?.label ?? key;
  }

  /** Badge de alcance de una membership: "Organización" o "P-001 — Proyecto Uno". */
  function scopeLabelFor(m: UserMembership): string {
    if (m.scopeType === 'ORGANIZATION') return 'Organización';
    const project = projects.find((p) => p.id === m.scopeId);
    return project ? `${project.code} — ${project.name}` : `Proyecto ${m.scopeId}`;
  }

  function handleSelectRole(key: string): void {
    setToAdd(key);
    const role = roles.find((r) => r.key === key);
    if (!role) {
      setScopeType('');
      setScopeId('');
      return;
    }
    const defaultScope = role.allowedScopeTypes[0] ?? 'ORGANIZATION';
    setScopeType(defaultScope);
    setScopeId(defaultScope === 'ORGANIZATION' ? ORG_SCOPE_ID : '');
  }

  const needsProject = scopeType === 'PROJECT';
  const canAdd = toAdd !== '' && scopeType !== '' && scopeId !== '';

  async function add(): Promise<void> {
    // Guarda explícita sobre `scopeType` (no vía `canAdd`) para que TS lo
    // estreche a `ScopeType` al construir el `AssignRoleInput`.
    if (!user || toAdd === '' || scopeType === '' || scopeId === '') return;
    setBusy(true);
    setError(null);
    try {
      const input: AssignRoleInput = { roleKey: toAdd, scopeType, scopeId };
      const res = await onAssign(user.id, input);
      setMemberships(res.memberships);
      setToAdd('');
      setScopeType('');
      setScopeId('');
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asignar el rol.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(membership: UserMembership): Promise<void> {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      // H13: se pasa la membership EXACTA (roleKey + scopeType + scopeId), sin defaults.
      const res = await onRemove(user.id, membership);
      setMemberships(res.memberships);
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el rol.');
      throw err;
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
            <ModalDescription>Roles asignados y su alcance (organización o proyecto).</ModalDescription>
          </ModalHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {memberships.length === 0 && (
                <span className="text-sm text-muted-foreground">Sin roles asignados.</span>
              )}
              {memberships.map((m) => (
                <span
                  key={`${m.roleKey}|${m.scopeType}|${m.scopeId}`}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs font-medium text-secondary-foreground"
                >
                  {roleLabelFor(m.roleKey)}
                  <span className="rounded-full bg-background/60 px-1.5 py-px text-[10px] font-normal text-muted-foreground">
                    {scopeLabelFor(m)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setToRemove(m)}
                    disabled={busy}
                    aria-label={`Quitar rol ${roleLabelFor(m.roleKey)} (${scopeLabelFor(m)})`}
                    className="rounded-full p-0.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium leading-none">Agregar rol</span>
                <select
                  aria-label="Agregar rol"
                  value={toAdd}
                  onChange={(e) => handleSelectRole(e.target.value)}
                  disabled={busy}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <option value="">Selecciona un rol…</option>
                  {assignableRoles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedRole && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">Alcance</span>
                  <select
                    aria-label="Alcance"
                    value={scopeType}
                    onChange={(e) => {
                      const next = e.target.value as ScopeType;
                      setScopeType(next);
                      setScopeId(next === 'ORGANIZATION' ? ORG_SCOPE_ID : '');
                    }}
                    disabled={busy || selectedRole.allowedScopeTypes.length <= 1}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                  >
                    {selectedRole.allowedScopeTypes.map((st) => (
                      <option key={st} value={st}>
                        {st === 'ORGANIZATION' ? 'Organización' : 'Proyecto'}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {needsProject && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">Proyecto</span>
                  <select
                    aria-label="Proyecto"
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    disabled={busy}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                  >
                    <option value="">Selecciona un proyecto…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex justify-end">
                <Button type="button" onClick={() => void add()} disabled={busy || !canAdd}>
                  <Plus aria-hidden />
                  Agregar
                </Button>
              </div>
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
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        title="¿Quitar rol?"
        description={
          toRemove ? (
            <>
              ¿Seguro que deseas quitar el rol <strong>{roleLabelFor(toRemove.roleKey)}</strong> (
              {scopeLabelFor(toRemove)}) a{' '}
              <strong>{user ? `${user.firstName} ${user.lastName}` : ''}</strong>?
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Quitar rol"
        onConfirm={async () => {
          if (toRemove) {
            await remove(toRemove);
            setToRemove(null);
          }
        }}
      />
    </>
  );
}
