import { useState, type ReactNode } from 'react';
import { Check, Inbox, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { RejectDialog } from '@/components/ui/reject-dialog';
import { errorToMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { roleLabel } from '@/lib/role-labels';
import type { PermissionRequestAdminView } from '@/types/settings';

interface PendingRequestsSectionProps {
  pending: PermissionRequestAdminView[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
}

/** Nombre completo legible del solicitante. */
function requesterName(req: PermissionRequestAdminView): string {
  return `${req.requester.firstName} ${req.requester.lastName}`.trim();
}

/**
 * Sección de admin "Solicitudes pendientes" (§6-2.3d). Solo se monta si el
 * usuario es admin (probe sin 403). Lista cada solicitud con solicitante, rol y
 * motivo, y permite Aprobar o Rechazar (rechazar pide un motivo opcional en un
 * modal). Tras decidir, el hook refresca las pendientes.
 */
export function PendingRequestsSection({
  pending,
  onApprove,
  onReject,
}: PendingRequestsSectionProps): ReactNode {
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] =
    useState<PermissionRequestAdminView | null>(null);

  const handleApprove = async (id: string): Promise<void> => {
    setError(null);
    setActingId(id);
    try {
      await onApprove(id);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo aprobar la solicitud.'));
    } finally {
      setActingId(null);
    }
  };

  const openReject = (req: PermissionRequestAdminView): void => {
    setError(null);
    setRejectTarget(req);
  };

  /**
   * Confirma el rechazo. Lanza para que `RejectDialog` muestre el error y no
   * cierre; al resolver, el diálogo se cierra solo y limpiamos el objetivo.
   */
  const confirmReject = async (reason: string): Promise<void> => {
    if (!rejectTarget) return;
    const { id } = rejectTarget;
    await onReject(id, reason || undefined);
    setRejectTarget(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Solicitudes pendientes</CardTitle>
        <CardDescription>
          Solicitudes de acceso de otros usuarios esperando tu decisión.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" live className="mb-3">
            {error}
          </Alert>
        )}

        {pending.length === 0 ? (
          <EmptyState
            icon={Inbox}
            message="No hay solicitudes pendientes. Cuando alguien pida un rol, aparecerá aquí."
          />
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((req) => (
              <li
                key={req.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {requesterName(req)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {req.requester.email}
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    Rol: <span className="font-medium">{roleLabel(req.roleKey)}</span>
                  </p>
                  {req.reason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Motivo: {req.reason}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Solicitada el {formatDate(req.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleApprove(req.id)}
                    loading={actingId === req.id}
                    disabled={actingId !== null}
                  >
                    <Check className="size-4" aria-hidden />
                    Aprobar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openReject(req)}
                    disabled={actingId !== null}
                  >
                    <X className="size-4" aria-hidden />
                    Rechazar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <RejectDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
        title="Rechazar solicitud"
        description={
          rejectTarget
            ? `${requesterName(rejectTarget)} · ${roleLabel(rejectTarget.roleKey)}`
            : undefined
        }
        confirmLabel="Rechazar solicitud"
        reasonRequired={false}
        reasonMaxLength={500}
        onConfirm={confirmReject}
      />
    </Card>
  );
}
