import { useState, type ReactNode } from 'react';
import { MapPin, ArrowRightLeft, ClipboardCheck, Camera, History as HistoryIcon } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import type { UsageCycleStatus, UsageCycleView } from '@/types/assets';
import {
  USAGE_END_KIND_LABELS,
  USAGE_STATUS_LABELS,
  formatCycleDuration,
  personName,
} from './usage-cycle-shared';

export interface UsageHistoryProps {
  /** Ciclos ya cargados por el detalle del activo (más recientes primero). */
  cycles: UsageCycleView[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const STATUS_VARIANT: Record<UsageCycleStatus, BadgeProps['variant']> = {
  EN_PREPARACION: 'warning',
  EN_CURSO: 'info',
  CERRADO: 'neutral',
  CANCELADO: 'danger',
};

function StatusBadge({ status }: { status: UsageCycleStatus }): ReactNode {
  return <Badge variant={STATUS_VARIANT[status]}>{USAGE_STATUS_LABELS[status]}</Badge>;
}

/** Resumen textual de la forma de cierre + su dato (para la celda de la tabla). */
function endSummary(cycle: UsageCycleView): string {
  if (!cycle.endKind) return '—';
  const label = USAGE_END_KIND_LABELS[cycle.endKind];
  if (cycle.endKind === 'GPS' && cycle.endLatitude != null && cycle.endLongitude != null) {
    return `${label} (${cycle.endLatitude.toFixed(5)}, ${cycle.endLongitude.toFixed(5)})`;
  }
  if (cycle.endKind === 'ESTACIONAMIENTO' && cycle.endText) {
    return `${label}: ${cycle.endText}`;
  }
  if (cycle.endKind === 'TRASPASO') {
    return `${label} a ${personName(cycle.handoffTo)}`;
  }
  return label;
}

/**
 * Tabla de CICLOS de uso de un activo (pestaña Historial). Un clic en la fila abre
 * el detalle del ciclo (fotos, checklist ligado, ubicación / estacionamiento /
 * traspaso). Mobile-first: la tabla scrollea en horizontal en pantallas chicas.
 */
export function UsageHistory({ cycles, loading = false, error = null, onRetry }: UsageHistoryProps): ReactNode {
  const [selected, setSelected] = useState<UsageCycleView | null>(null);

  if (loading) return <LoadingState rows={4} label="Cargando ciclos de uso…" />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (cycles.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="Sin ciclos de uso"
        message="Cuando alguien reporte uso de este activo, el ciclo aparecerá aquí."
      />
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuario</TableHead>
            <TableHead>Inicio</TableHead>
            <TableHead>Término</TableHead>
            <TableHead>Duración</TableHead>
            <TableHead>Cierre</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cycles.map((cycle) => (
            <TableRow
              key={cycle.id}
              className="cursor-pointer"
              onClick={() => setSelected(cycle)}
              tabIndex={0}
              role="button"
              aria-label={`Ver detalle del ciclo de uso de ${personName(cycle.user)}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelected(cycle);
                }
              }}
            >
              <TableCell className="font-medium text-foreground">{personName(cycle.user)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(cycle.startedAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {cycle.endedAt ? formatDateTime(cycle.endedAt) : '—'}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {formatCycleDuration(cycle.confirmedAt ?? cycle.startedAt, cycle.endedAt)}
              </TableCell>
              <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                {endSummary(cycle)}
              </TableCell>
              <TableCell>
                <StatusBadge status={cycle.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Modal open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <ModalContent className="sm:max-w-lg">
          {selected && <CycleDetail cycle={selected} />}
        </ModalContent>
      </Modal>
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

function CycleDetail({ cycle }: { cycle: UsageCycleView }): ReactNode {
  return (
    <>
      <ModalHeader>
        <ModalTitle className="flex items-center gap-2">
          Ciclo de uso
          <StatusBadge status={cycle.status} />
        </ModalTitle>
        <ModalDescription>{personName(cycle.user)}</ModalDescription>
      </ModalHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <DetailRow label="Inicio">{formatDateTime(cycle.startedAt)}</DetailRow>
          {cycle.confirmedAt && <DetailRow label="Confirmado">{formatDateTime(cycle.confirmedAt)}</DetailRow>}
          <DetailRow label="Término">
            {cycle.endedAt ? formatDateTime(cycle.endedAt) : 'En curso'}
          </DetailRow>
          <DetailRow label="Duración">
            {formatCycleDuration(cycle.confirmedAt ?? cycle.startedAt, cycle.endedAt)}
          </DetailRow>
        </div>

        {cycle.endKind && (
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="mb-1.5 text-xs font-semibold text-primary">Forma de cierre</p>
            {cycle.endKind === 'GPS' && (
              <p className="flex items-center gap-1.5 text-sm text-foreground">
                <MapPin className="size-4 text-primary" aria-hidden />
                {cycle.endLatitude != null && cycle.endLongitude != null ? (
                  <span className="font-mono">
                    {cycle.endLatitude.toFixed(6)}, {cycle.endLongitude.toFixed(6)}
                  </span>
                ) : (
                  'Ubicación GPS'
                )}
              </p>
            )}
            {cycle.endKind === 'ESTACIONAMIENTO' && (
              <p className="text-sm text-foreground">
                <MapPin className="mr-1.5 inline size-4 text-primary" aria-hidden />
                {cycle.endText || 'Estacionamiento'}
              </p>
            )}
            {cycle.endKind === 'TRASPASO' && (
              <p className="flex items-center gap-1.5 text-sm text-foreground">
                <ArrowRightLeft className="size-4 text-primary" aria-hidden />
                Traspaso a {personName(cycle.handoffTo)}
              </p>
            )}
          </div>
        )}

        {cycle.checklistSubmissionId && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ClipboardCheck className="size-4 text-primary" aria-hidden />
            Checklist inicial firmado y ligado a este ciclo.
          </p>
        )}

        {(cycle.startPhotoUrl || cycle.endPhotoUrl) && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Camera className="size-3.5" aria-hidden />
              Fotos
            </p>
            <div className="flex flex-wrap gap-3">
              {cycle.startPhotoUrl && <PhotoThumb url={cycle.startPhotoUrl} label="Al recoger" />}
              {cycle.endPhotoUrl && <PhotoThumb url={cycle.endPhotoUrl} label="Al dejar" />}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function PhotoThumb({ url, label }: { url: string; label: string }): ReactNode {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <img
        src={url}
        alt={label}
        className="size-24 rounded-md border border-border object-cover"
      />
      {label}
    </a>
  );
}
