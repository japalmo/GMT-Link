import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Inbox, Loader2, Play, Plus, SlidersHorizontal } from 'lucide-react';
import * as api from '@/lib/api';
import { errorToMessage } from '@/lib/api';
import type {
  TicketLane,
  TicketPriority,
  TicketQueueStats,
  TicketSize,
  TicketView,
} from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useDataTable } from '@/hooks/use-data-table';
import {
  DataTable,
  type DataTableColumn,
} from '@/components/primitives/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { TicketDetalle } from './ticket-detalle';
import {
  TICKET_LANE_LABELS,
  TICKET_PRIORITY_META,
  TICKET_SIZE_LABELS,
  TICKET_STATUS_META,
  TICKET_TYPE_LABELS,
  moduleLabel,
  slaVencido,
} from './soporte-shared';

/** Tarjeta de contador de la cola. */
function Contador({
  icon: Icon,
  label,
  valor,
  destacado,
}: {
  icon: typeof Inbox;
  label: string;
  valor: number;
  destacado?: boolean;
}) {
  return (
    <Card className={destacado && valor > 0 ? 'border-rose-500/40' : undefined}>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon
          className={`size-5 ${destacado && valor > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}
          aria-hidden
        />
        <div className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{valor}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Panel de Informática. Ordena por SLA más próximo a vencer, que es la pregunta
 * que el área se hace al abrir. Desde acá se clasifica (vía, tamaño, prioridad)
 * y se mueve el ticket; las transiciones válidas las decide el servidor.
 */
export default function SoportePage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<TicketQueueStats | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [triage, setTriage] = useState<TicketView | null>(null);

  const fetcher = useCallback(api.fetchTicketsTable, []);
  const table = useDataTable<TicketView>(fetcher, { initialPageSize: 10 });
  const { refetch } = table;

  const cargarStats = useCallback(async (): Promise<void> => {
    try {
      setStats(await api.getTicketStats());
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    void cargarStats();
  }, [cargarStats]);

  const refrescar = useCallback((): void => {
    refetch();
    void cargarStats();
  }, [refetch, cargarStats]);

  const columns = useMemo<ReadonlyArray<DataTableColumn<TicketView>>>(
    () => [
      {
        id: 'numero',
        header: 'Ticket',
        sortable: true,
        render: (t) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs text-muted-foreground">{t.ticketNumber}</span>
            <span className="text-sm font-medium text-foreground">{t.title}</span>
          </div>
        ),
      },
      {
        id: 'area',
        header: 'Área',
        render: (t) => (
          <div className="flex flex-col">
            <span className="text-sm text-foreground">{t.department?.name ?? '—'}</span>
            <span className="text-xs text-muted-foreground">{t.requesterName}</span>
          </div>
        ),
      },
      {
        id: 'modulo',
        header: 'Módulo',
        render: (t) => (
          <span className="text-sm text-muted-foreground">{moduleLabel(t.module)}</span>
        ),
      },
      {
        id: 'estado',
        header: 'Estado',
        sortable: true,
        render: (t) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={TICKET_STATUS_META[t.status].variant}>
              {TICKET_STATUS_META[t.status].label}
            </Badge>
            {slaVencido(t.status, t.slaTriageDueAt) && <Badge variant="danger">SLA</Badge>}
          </div>
        ),
      },
      {
        id: 'prioridad',
        header: 'Prioridad',
        sortable: true,
        render: (t) =>
          t.priority ? (
            <Badge variant={TICKET_PRIORITY_META[t.priority].variant}>
              {TICKET_PRIORITY_META[t.priority].label}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Sin clasificar</span>
          ),
      },
      {
        id: 'sla',
        header: 'Plazo triage',
        render: (t) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {t.slaTriageDueAt ? formatDate(t.slaTriageDueAt) : '—'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="Soporte TI"
        description="Cola de solicitudes al área de Informática, ordenada por plazo de triage más próximo."
        actions={
          <Button onClick={() => navigate('/tickets/nuevo')}>
            <Plus className="size-4" aria-hidden />
            Levantar ticket
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Contador icon={Inbox} label="Sin triage" valor={stats?.sinTriage ?? 0} />
        <Contador icon={AlertTriangle} label="SLA vencido" valor={stats?.slaVencido ?? 0} destacado />
        <Contador icon={Play} label="En curso" valor={stats?.enCurso ?? 0} />
      </div>

      <DataTable
        table={table}
        columns={columns}
        getRowId={(t) => t.id}
        searchable
        searchPlaceholder="Buscar por número, título, solicitante o módulo…"
        onRowClick={(t) => setAbierto(t.id)}
        emptyMessage="No hay tickets en la cola"
        filters={[
          {
            id: 'status',
            label: 'Estado',
            allLabel: 'Todos',
            options: (
              Object.keys(TICKET_STATUS_META) as Array<keyof typeof TICKET_STATUS_META>
            ).map((k) => ({ value: k, label: TICKET_STATUS_META[k].label })),
          },
          {
            id: 'type',
            label: 'Tipo',
            allLabel: 'Todos',
            options: (
              Object.keys(TICKET_TYPE_LABELS) as Array<keyof typeof TICKET_TYPE_LABELS>
            ).map((k) => ({ value: k, label: TICKET_TYPE_LABELS[k] })),
          },
          {
            id: 'priority',
            label: 'Prioridad',
            allLabel: 'Todas',
            options: (
              Object.keys(TICKET_PRIORITY_META) as Array<keyof typeof TICKET_PRIORITY_META>
            ).map((k) => ({ value: k, label: TICKET_PRIORITY_META[k].label })),
          },
          {
            id: 'lane',
            label: 'Vía',
            allLabel: 'Todas',
            options: (Object.keys(TICKET_LANE_LABELS) as TicketLane[]).map((k) => ({
              value: k,
              label: TICKET_LANE_LABELS[k],
            })),
          },
        ]}
        rowActions={(t) => (
          <Button
            variant="ghost"
            size="sm"
            title="Clasificar"
            onClick={(e) => {
              e.stopPropagation();
              setTriage(t);
            }}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Clasificar
          </Button>
        )}
        rowActionsLabel="Acciones"
      />

      <TicketDetalle
        ticketId={abierto}
        onOpenChange={(open) => !open && setAbierto(null)}
        onChanged={refrescar}
      />

      <TriageDialog ticket={triage} onClose={() => setTriage(null)} onSaved={refrescar} />
    </PageContainer>
  );
}

/**
 * Clasificación del triage. No mueve el estado: aceptar al backlog es una
 * transición aparte, y el backend la rechaza si falta vía, tamaño o prioridad.
 */
function TriageDialog({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lane, setLane] = useState<string>('');
  const [size, setSize] = useState<string>('');
  const [priority, setPriority] = useState<string>('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setLane(ticket?.lane ?? '');
    setSize(ticket?.size ?? '');
    setPriority(ticket?.priority ?? '');
  }, [ticket]);

  const guardar = async (): Promise<void> => {
    if (!ticket) return;
    setGuardando(true);
    try {
      await api.triageTicket(ticket.id, {
        lane: (lane || undefined) as TicketLane | undefined,
        size: (size || undefined) as TicketSize | undefined,
        priority: (priority || undefined) as TicketPriority | undefined,
      });
      toast.success('Clasificación guardada.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo guardar la clasificación.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={ticket !== null} onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Clasificar ticket</ModalTitle>
          <ModalDescription>
            {ticket?.ticketNumber} · {ticket?.title}
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tr-lane">Vía</Label>
            <Select
              id="tr-lane"
              aria-label="Vía de atención"
              value={lane}
              onChange={(e) => setLane(e.target.value)}
              disabled={guardando}
            >
              <option value="">Sin definir</option>
              {(Object.keys(TICKET_LANE_LABELS) as TicketLane[]).map((k) => (
                <option key={k} value={k}>
                  {TICKET_LANE_LABELS[k]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              La vía rápida se resuelve dentro del backlog; la de proyecto pasa por levantamiento y
              diseño.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tr-size">Tamaño</Label>
            <Select
              id="tr-size"
              aria-label="Tamaño estimado"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              disabled={guardando}
            >
              <option value="">Sin definir</option>
              {(Object.keys(TICKET_SIZE_LABELS) as TicketSize[]).map((k) => (
                <option key={k} value={k}>
                  {TICKET_SIZE_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tr-priority">Prioridad</Label>
            <Select
              id="tr-priority"
              aria-label="Prioridad"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={guardando}
            >
              <option value="">Sin definir</option>
              {(Object.keys(TICKET_PRIORITY_META) as TicketPriority[]).map((k) => (
                <option key={k} value={k}>
                  {TICKET_PRIORITY_META[k].label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void guardar()} disabled={guardando}>
            {guardando && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Guardar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
