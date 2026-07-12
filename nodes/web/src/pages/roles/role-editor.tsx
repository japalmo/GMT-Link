import { useEffect, useId, useState, type ReactNode } from 'react';
import { Copy, Lock } from 'lucide-react';
import type {
  CreateRoleInput,
  PermissionCatalogGroup,
  PermissionScopeValue,
  RoleDetail,
  RoleGrant,
  UpdateRoleInput,
} from '@gmt-platform/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorToMessage } from '@/lib/api';
import { moduleLabel } from '@/lib/role-labels';
import { cn } from '@/lib/utils';

const SCOPE_OPTIONS: ReadonlyArray<{ value: PermissionScopeValue; label: string }> = [
  { value: 'OWN', label: 'Solo propio' },
  { value: 'PROJECT', label: 'Proyectos asociados' },
  { value: 'GLOBAL', label: 'Todo' },
];

/** Estado local de edición: mapa permissionKey -> { checked, scope }. */
interface GrantDraft {
  checked: boolean;
  scope: PermissionScopeValue;
}

function buildInitialDrafts(grants: readonly RoleGrant[]): Map<string, GrantDraft> {
  const map = new Map<string, GrantDraft>();
  for (const g of grants) {
    map.set(g.permissionKey, { checked: true, scope: g.scope });
  }
  return map;
}

/**
 * Editor de un rol (§Fase 5 — matriz RBAC). Para roles personalizados permite
 * editar nombre/descripción y componer permisos del catálogo agrupados por
 * módulo, con checkbox + selector de alcance cuando el permiso es
 * `scopeable`. Los ítems `composable=false` quedan deshabilitados. Los roles
 * del sistema (`isSystem=true`) se muestran en modo solo lectura con la
 * acción "Clonar".
 */
export function RoleEditor({
  role,
  catalog,
  onSave,
  onClone,
}: {
  role: RoleDetail;
  catalog: PermissionCatalogGroup[];
  onSave: (key: string, input: UpdateRoleInput | CreateRoleInput) => Promise<void>;
  onClone: (key: string) => void;
}): ReactNode {
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description ?? '');
  const [drafts, setDrafts] = useState<Map<string, GrantDraft>>(() => buildInitialDrafts(role.grants));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupId = useId();

  useEffect(() => {
    setLabel(role.label);
    setDescription(role.description ?? '');
    setDrafts(buildInitialDrafts(role.grants));
    setError(null);
  }, [role]);

  const readOnly = role.isSystem;

  function toggle(permissionKey: string, checked: boolean, defaultScope: PermissionScopeValue): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      if (checked) {
        const existing = next.get(permissionKey);
        next.set(permissionKey, { checked: true, scope: existing?.scope ?? defaultScope });
      } else {
        next.delete(permissionKey);
      }
      return next;
    });
  }

  function setScope(permissionKey: string, scope: PermissionScopeValue): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      const existing = next.get(permissionKey);
      if (existing) next.set(permissionKey, { ...existing, scope });
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    const grants: RoleGrant[] = Array.from(drafts.entries()).map(([permissionKey, draft]) => ({
      permissionKey,
      scope: draft.scope,
    }));
    try {
      await onSave(role.key, { label, description: description || undefined, grants });
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar el rol.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-1 flex-col gap-3">
          <Label className="flex flex-col gap-1.5">
            <span>Nombre</span>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={readOnly}
            />
          </Label>
          <Label className="flex flex-col gap-1.5">
            <span>Descripción</span>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              rows={2}
            />
          </Label>
        </div>

        {readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="neutral">
              <Lock className="mr-1 size-3" aria-hidden />
              Rol del sistema
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => onClone(role.key)}>
              <Copy aria-hidden />
              Clonar
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {catalog.map((group) => (
          <fieldset key={group.module} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {moduleLabel(group.module)}
            </legend>
            <div className="flex flex-col gap-1.5">
              {group.items.map((item) => {
                const draft = drafts.get(item.key);
                const checked = draft?.checked ?? false;
                const disabled = readOnly || !item.composable;
                const checkboxId = `${groupId}-${item.key}`;
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'flex flex-col gap-2 rounded-md border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between',
                      checked && 'border-primary/40 bg-primary/5',
                      disabled && 'opacity-60',
                    )}
                    title={!item.composable ? 'Este permiso no es componible en roles personalizados.' : undefined}
                  >
                    <div className="flex flex-1 flex-col gap-1">
                      <label htmlFor={checkboxId} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(e) => toggle(item.key, e.target.checked, 'GLOBAL')}
                          className="size-4 rounded border-input accent-primary outline-none"
                        />
                        {item.label}
                      </label>
                      {item.kind === 'STRUCTURAL' && !item.composable && (
                        <Badge variant="neutral" className="w-fit font-normal">
                          Se otorga al asignar a un proyecto o activo
                        </Badge>
                      )}
                    </div>

                    {item.scopeable && (
                      <label
                        htmlFor={`${checkboxId}-scope`}
                        className={cn(
                          'flex items-center gap-1.5 text-xs text-muted-foreground',
                          !checked && 'opacity-60',
                        )}
                      >
                        {`Alcance de ${item.label}`}
                        <Select
                          id={`${checkboxId}-scope`}
                          aria-label={`Alcance de ${item.label}`}
                          value={draft?.scope ?? 'GLOBAL'}
                          disabled={readOnly || !checked}
                          onChange={(e) => setScope(item.key, e.target.value as PermissionScopeValue)}
                          className="h-8 w-auto px-2 text-xs"
                        >
                          {SCOPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </Select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {error && (
        <Alert variant="destructive" live>
          {error}
        </Alert>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            Guardar
          </Button>
        </div>
      )}
    </div>
  );
}
