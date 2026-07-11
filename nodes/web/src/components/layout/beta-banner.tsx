import { AlertTriangle } from 'lucide-react';
import { useHasPermission } from '@/hooks/use-has-permission';

/**
 * Banner no intrusivo para usuarios con `system:beta:full` (gerencias RH/general,
 * spec §3.2). Advierte que la versión está en desarrollo. Se oculta para el resto
 * (incluidos org_admin/admin_ti, que NO reciben system:beta:full).
 */
export function BetaBanner() {
  const isBeta = useHasPermission('system:beta:full');
  if (!isBeta) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>
        Versión beta en desarrollo. Se sugiere no realizar cambios sin consultar con el
        administrador del sistema.
      </span>
    </div>
  );
}
