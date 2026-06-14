import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  FileX2,
  Loader2,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import type { ApprovalItem, ApprovalStatus } from './types';

/**
 * Render del contenido versionado. El consumidor decide cómo pintar `T`
 * (texto, campos, tabla, …); la primitiva solo lo coloca en el diff.
 */
export type ApprovalValueRenderer<T> = (value: T) => ReactNode;

export interface ApprovalWorkflowProps<T> {
  /** Item a mostrar. Si es `null`/`undefined` se renderiza el estado vacío. */
  readonly item: ApprovalItem<T> | null | undefined;
  /** Cómo renderizar el contenido (`current` y `previous`). */
  readonly renderValue: ApprovalValueRenderer<T>;
  /**
   * Si el usuario actual puede aprobar/rechazar. Lo calcula el consumidor vía
   * OpenFGA (§3.1). Las acciones solo se muestran si es `true`.
   */
  readonly canApprove: boolean;
  /** Aprueba el item. Async: el componente muestra spinner mientras resuelve. */
  readonly onApprove?: () => void | Promise<void>;
  /** Rechaza el item con un motivo capturado en el modal. */
  readonly onReject?: (reason: string) => void | Promise<void>;
  /** Si hay una operación en curso (carga inicial o externa). */
  readonly loading?: boolean;
  /** Mensaje de error a mostrar (p. ej. fallo de red al persistir). */
  readonly error?: string | null;
  /** Etiqueta para la versión vigente. @defaultValue "Versión actual" */
  readonly currentLabel?: string;
  /** Etiqueta para la versión anterior. @defaultValue "Versión anterior" */
  readonly previousLabel?: string;
  /** Contenido del estado vacío (sin item). */
  readonly emptyState?: ReactNode;
  readonly className?: string;
}

interface StatusMeta {
  readonly label: string;
  readonly icon: typeof Clock;
  /** Clases de badge basadas en tokens del design system. */
  readonly badge: string;
}

const STATUS_META: Record<ApprovalStatus, StatusMeta> = {
  PENDIENTE: {
    label: 'Pendiente',
    icon: Clock,
    badge: 'border-border bg-muted text-muted-foreground',
  },
  APROBADO: {
    label: 'Aprobado',
    icon: CheckCircle2,
    badge: 'border-primary/30 bg-primary/10 text-primary',
  },
  RECHAZADO: {
    label: 'Rechazado',
    icon: XCircle,
    badge: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
};

/** Badge de estado, color por status reusando tokens. */
function StatusBadge({ status }: { status: ApprovalStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
        meta.badge,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}

/** Panel de una versión dentro del diff lado a lado. */
function VersionPanel<T>({
  label,
  value,
  renderValue,
  muted = false,
}: {
  label: string;
  value: T;
  renderValue: ApprovalValueRenderer<T>;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border p-3',
        muted && 'bg-muted/40',
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className={cn('text-sm', muted ? 'text-muted-foreground' : 'text-foreground')}>
        {renderValue(value)}
      </div>
    </div>
  );
}

/**
 * Componente presentacional de la primitiva ApprovalWorkflow (§5).
 *
 * Muestra el estado (badge por status), el diff `current` vs `previous` lado a
 * lado, y las acciones Aprobar/Rechazar — visibles SOLO si `canApprove`. El
 * rechazo abre un modal accesible con campo de motivo obligatorio. Al estar en
 * PENDIENTE se indica que se notificó al aprobador. Cubre los estados
 * vacío/carga/error.
 *
 * No decide permisos ni notifica: ambos los inyecta el consumidor.
 *
 * @typeParam T - Forma del contenido versionado que se aprueba.
 */
export function ApprovalWorkflow<T>({
  item,
  renderValue,
  canApprove,
  onApprove,
  onReject,
  loading = false,
  error = null,
  currentLabel = 'Versión actual',
  previousLabel = 'Versión anterior',
  emptyState,
  className,
}: ApprovalWorkflowProps<T>) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  // Estado de carga.
  if (loading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Cargando aprobación…
      </div>
    );
  }

  // Estado vacío.
  if (!item) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-8 text-center',
          className,
        )}
      >
        <FileX2 className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          {emptyState ?? 'No hay ningún item en revisión.'}
        </p>
      </div>
    );
  }

  const isPending = item.status === 'PENDIENTE';
  const showActions = canApprove && isPending;

  async function handleApprove(): Promise<void> {
    if (!onApprove) return;
    setBusy('approve');
    try {
      await onApprove();
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirmReject(): Promise<void> {
    if (!onReject) return;
    setBusy('reject');
    try {
      await onReject(reason);
      setRejectOpen(false);
      setReason('');
    } finally {
      setBusy(null);
    }
  }

  const reasonValid = reason.trim().length > 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-6',
        className,
      )}
    >
      {/* Cabecera: estado + metadatos de revisión */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge status={item.status} />
        {item.reviewedBy && (
          <p className="text-xs text-muted-foreground">
            {item.status === 'APROBADO' ? 'Aprobado por ' : 'Rechazado por '}
            <span className="font-medium text-foreground">{item.reviewedBy}</span>
            {item.reviewedAt && (
              <>
                {' · '}
                <time dateTime={item.reviewedAt}>
                  {new Date(item.reviewedAt).toLocaleString()}
                </time>
              </>
            )}
          </p>
        )}
      </div>

      {/* Indicación de notificación al aprobador */}
      {isPending && (
        <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Bell className="size-3.5 shrink-0" aria-hidden />
          <span>
            Se notificó al aprobador.
            {item.submittedBy && (
              <>
                {' Enviado por '}
                <span className="font-medium text-foreground">{item.submittedBy}</span>.
              </>
            )}
          </span>
        </div>
      )}

      {/* Motivo de rechazo */}
      {item.status === 'RECHAZADO' && item.reason && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">Motivo: </span>
            {item.reason}
          </p>
        </div>
      )}

      {/* Diff current vs previous */}
      <div
        className={cn(
          'grid gap-3',
          item.previous !== undefined && 'sm:grid-cols-2',
        )}
      >
        <VersionPanel
          label={currentLabel}
          value={item.current}
          renderValue={renderValue}
        />
        {item.previous !== undefined && (
          <VersionPanel
            label={previousLabel}
            value={item.previous}
            renderValue={renderValue}
            muted
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}

      {/* Acciones — solo si canApprove y pendiente */}
      {showActions && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="destructive"
            onClick={() => setRejectOpen(true)}
            disabled={busy !== null}
          >
            <XCircle aria-hidden />
            Rechazar
          </Button>
          <Button onClick={handleApprove} loading={busy === 'approve'}>
            <CheckCircle2 aria-hidden />
            Aprobar
          </Button>
        </div>
      )}

      {/* Modal de rechazo con motivo obligatorio */}
      <Modal
        open={rejectOpen}
        onOpenChange={(open) => {
          if (busy === 'reject') return;
          setRejectOpen(open);
          if (!open) setReason('');
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Rechazar versión</ModalTitle>
            <ModalDescription>
              Indica el motivo del rechazo. Se conservará junto a la versión anterior.
            </ModalDescription>
          </ModalHeader>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (reasonValid) void handleConfirmReject();
            }}
          >
            <Label htmlFor="approval-reject-reason">Motivo</Label>
            <textarea
              id="approval-reject-reason"
              className={cn(
                'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors',
                'placeholder:text-muted-foreground',
                'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/40',
              )}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej. Faltan firmas en la página 2."
              aria-invalid={!reasonValid && reason.length > 0}
              aria-describedby="approval-reject-hint"
              autoFocus
              disabled={busy === 'reject'}
            />
            <p id="approval-reject-hint" className="text-xs text-muted-foreground">
              El motivo es obligatorio.
            </p>
            <ModalFooter>
              <ModalClose asChild>
                <Button type="button" variant="outline" disabled={busy === 'reject'}>
                  Cancelar
                </Button>
              </ModalClose>
              <Button
                type="submit"
                variant="destructive"
                disabled={!reasonValid}
                loading={busy === 'reject'}
              >
                Confirmar rechazo
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}
