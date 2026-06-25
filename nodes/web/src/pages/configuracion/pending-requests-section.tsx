import { useId, useState, type ReactNode } from 'react';
import { Check, Inbox, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { ApiError } from '@/lib/api';
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
  const reasonId = useId();
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] =
    useState<PermissionRequestAdminView | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = async (id: string): Promise<void> => {
    setError(null);
    setActingId(id);
    try {
      await onApprove(id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudo aprobar la solicitud.',
      );
    } finally {
      setActingId(null);
    }
  };

  const openReject = (req: PermissionRequestAdminView): void => {
    setError(null);
    setRejectReason('');
    setRejectTarget(req);
  };

  const confirmReject = async (): Promise<void> => {
    if (!rejectTarget) return;
    const { id } = rejectTarget;
    setError(null);
    setActingId(id);
    try {
      await onReject(id, rejectReason);
      setRejectTarget(null);
      setRejectReason('');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudo rechazar la solicitud.',
      );
    } finally {
      setActingId(null);
    }
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
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
            <Inbox className="size-7 text-muted-foreground" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">
              No hay solicitudes pendientes. Cuando alguien pida un rol, aparecerá
              aquí.
            </p>
          </div>
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

      <Modal
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Rechazar solicitud</ModalTitle>
            <ModalDescription>
              {rejectTarget
                ? `${requesterName(rejectTarget)} · ${roleLabel(rejectTarget.roleKey)}`
                : ''}
            </ModalDescription>
          </ModalHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>Motivo (opcional)</Label>
            <textarea
              id={reasonId}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Explica por qué se rechaza (lo verá quien solicitó)."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <ModalFooter>
            <ModalClose asChild>
              <Button variant="outline" disabled={actingId !== null}>
                Cancelar
              </Button>
            </ModalClose>
            <Button
              variant="destructive"
              onClick={() => void confirmReject()}
              loading={actingId !== null && rejectTarget !== null}
            >
              Rechazar solicitud
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}
