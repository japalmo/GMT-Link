import { useId, type ReactNode } from 'react';
import { ROLE_KEYS, type RoleKey } from '@gtm-link/shared-types';
import { roleLabel } from '@/lib/role-labels';
import { cn } from '@/lib/utils';

/**
 * Selección múltiple de roles por defecto a partir de {@link ROLE_KEYS}.
 * Render como grupo de checkboxes accesible (fieldset/legend). Controlado por
 * el formulario padre.
 */
export function RoleMultiSelect({
  value,
  onChange,
  legend = 'Roles por defecto',
  describedById,
  disabled = false,
}: {
  value: readonly RoleKey[];
  onChange: (next: RoleKey[]) => void;
  legend?: string;
  describedById?: string;
  disabled?: boolean;
}): ReactNode {
  const groupId = useId();

  function toggle(role: RoleKey, checked: boolean): void {
    if (checked) {
      if (!value.includes(role)) onChange([...value, role]);
    } else {
      onChange(value.filter((r) => r !== role));
    }
  }

  return (
    <fieldset
      aria-describedby={describedById}
      className="flex flex-col gap-1.5"
      disabled={disabled}
    >
      <legend className="mb-1 text-sm font-medium leading-none text-foreground">
        {legend}
      </legend>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {ROLE_KEYS.map((role) => {
          const checkboxId = `${groupId}-${role}`;
          const checked = value.includes(role);
          return (
            <label
              key={role}
              htmlFor={checkboxId}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors',
                'hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                checked && 'border-primary/40 bg-primary/5',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                id={checkboxId}
                type="checkbox"
                className="size-4 rounded border-input accent-primary outline-none"
                checked={checked}
                disabled={disabled}
                onChange={(e) => toggle(role, e.target.checked)}
              />
              <span>{roleLabel(role)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
