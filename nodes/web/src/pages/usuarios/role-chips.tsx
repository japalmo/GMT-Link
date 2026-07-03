import type { ReactNode } from 'react';
import type { RoleKey, UserMembership } from '@gmt-platform/contracts';
import { roleLabel } from '@/lib/role-labels';

/** Badge por defecto del alcance (sin catálogo de proyectos a mano). */
function defaultScopeLabel(m: UserMembership): string {
  return m.scopeType === 'ORGANIZATION' ? 'Organización' : `Proyecto ${m.scopeId}`;
}

/** Estilo compartido de cada chip de rol. */
const CHIP_CLASS =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground';

/** Badge de alcance dentro de un chip. */
const SCOPE_BADGE_CLASS =
  'rounded-full bg-background/60 px-1.5 py-px text-[10px] font-normal text-muted-foreground';

/**
 * Chips de roles legibles. Admite dos modos según los datos disponibles:
 *
 * - `memberships`: un chip POR MEMBERSHIP (rol + badge de alcance
 *   "Organización" / "Proyecto X") — usado en el directorio de usuarios (H13).
 *   `scopeLabel` permite al llamador resolver nombres de proyecto si los tiene.
 * - `roleKeys`: un chip por rol, sin alcance — usado donde solo se conocen los
 *   roles por defecto (directorio general, perfil propio).
 *
 * Sin datos → guion apagado.
 */
export function RoleChips(
  props:
    | { memberships: readonly UserMembership[]; scopeLabel?: (m: UserMembership) => string }
    | { roleKeys: readonly RoleKey[] },
): ReactNode {
  if ('memberships' in props) {
    const { memberships, scopeLabel = defaultScopeLabel } = props;
    if (memberships.length === 0) {
      return <span className="text-sm text-muted-foreground">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {memberships.map((m) => (
          <span key={`${m.roleKey}|${m.scopeType}|${m.scopeId}`} className={CHIP_CLASS}>
            {roleLabel(m.roleKey)}
            <span className={SCOPE_BADGE_CLASS}>{scopeLabel(m)}</span>
          </span>
        ))}
      </div>
    );
  }

  const { roleKeys } = props;
  if (roleKeys.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roleKeys.map((role) => (
        <span key={role} className={CHIP_CLASS}>
          {roleLabel(role)}
        </span>
      ))}
    </div>
  );
}
