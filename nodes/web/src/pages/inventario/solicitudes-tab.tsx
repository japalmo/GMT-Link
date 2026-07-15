import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ClipboardList, History, Loader2 } from 'lucide-react';
import type {
  SupplyAssignmentView,
  SupplyRequestStatus,
  SupplyRequestView,
  TableRequest,
} from '@gmt-platform/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import { DataTable, type DataTableColumn, type DataTableFilter } from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { RequestStatusBadge, STATUS_LABEL } from '@/components/inventory/request-status';
import { formatDateTime } from '@/lib/format';
import {
  deliverSupplyRequest,
  errorToMessage,
  fetchAssignmentsTable,
  fetchSupplyRequestsTable,
  listWarehouses,
  rejectSupplyRequest,
  type WarehouseView,
} from '@/lib/api';

const STATUS_OPTIONS: ReadonlyArray<SupplyRequestStatus> = ['PENDIENTE', 'ENTREGADA', 'RECHAZADA'];

/**
 * Estado de la carga de bodegas: el diálogo Entregar y el Historial distinguen
 * "cargando" y "falló" (con reintento) del vacío real, para no dar la guía de
 * estado vacío ('Crea una bodega...') cuando en realidad falló la red.
 */
interface WarehousesState {
  status: 'loading' | 'error' | 'ready';
  list: WarehouseView[];
}

/** Resumen legible de los ítems de una solicitud ("2x Casco, 1x Guantes"). */
function itemsSummary(request: SupplyRequestView): string {
  return request.items.map((item) => `${item.quantity}x ${item.supplyName}`).join(', ');
}

type SolicitudesView = 'solicitudes' | 'historial';

const VIEW_TABS: ReadonlyArray<TabItem<SolicitudesView>> = [
  { value: 'solicitudes', label: 'Solicitudes', icon: ClipboardList },
  { value: 'historial', label: 'Historial de entregas', icon: History },
];

/**
 * Pestaña Solicitudes del módulo Inventario (gestión para logística/admins):
 * la cola de solicitudes de insumos (entregar/rechazar las pendientes) y el
 * historial completo de entregas, como sub-vistas alternables.
 */
export function SolicitudesTab(): ReactNode {
  const [view, setView] = useState<SolicitudesView>('solicitudes');
  const idBase = useId();

  // Bodegas: las usa el diálogo de entrega (origen del stock) y el historial
  // (mapear warehouseId a nombre). Una sola carga para ambas sub-vistas, con
  // fases explícitas (loading/error/ready) y reintento.
  const [warehousesState, setWarehousesState] = useState<WarehousesState>({
    status: 'loading',
    list: [],
  });
  // Token incremental: descarta respuestas de cargas superadas (o del desmontaje).
  const loadTokenRef = useRef(0);
  const reloadWarehouses = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setWarehousesState({ status: 'loading', list: [] });
    try {
      const list = await listWarehouses();
      if (loadTokenRef.current === token) setWarehousesState({ status: 'ready', list });
    } catch {
      if (loadTokenRef.current === token) setWarehousesState({ status: 'error', list: [] });
    }
  }, []);
  useEffect(() => {
    void reloadWarehouses();
    return () => {
      loadTokenRef.current++;
    };
  }, [reloadWarehouses]);

  return (
    <div className="flex flex-col gap-4">
      <Tabs<SolicitudesView>
        aria-label="Vistas de solicitudes de insumos"
        items={VIEW_TABS}
        value={view}
        onValueChange={setView}
        idBase={idBase}
      />

      <div
        role="tabpanel"
        id={tabPanelId(idBase, view)}
        aria-labelledby={tabTriggerId(idBase, view)}
        tabIndex={0}
      >
        {view === 'solicitudes' ? (
          <RequestsView warehousesState={warehousesState} onReloadWarehouses={reloadWarehouses} />
        ) : (
          <AssignmentsHistoryView
            warehousesState={warehousesState}
            onReloadWarehouses={reloadWarehouses}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Sub-vista SOLICITUDES: cola de gestión con entregar/rechazar.
   -------------------------------------------------------------------------- */

function RequestsView({
  warehousesState,
  onReloadWarehouses,
}: {
  warehousesState: WarehousesState;
  onReloadWarehouses: () => void;
}): ReactNode {
  const fetcher = useCallback((req: TableRequest) => fetchSupplyRequestsTable(req), []);
  const table = useDataTable<SupplyRequestView>(fetcher, {
    initialSortBy: 'fecha',
    initialSortDir: 'desc',
  });

  const [toDeliver, setToDeliver] = useState<SupplyRequestView | null>(null);
  const [toReject, setToReject] = useState<SupplyRequestView | null>(null);

  const statusFilter: DataTableFilter = {
    id: 'status',
    label: 'Estado',
    allLabel: 'Todos los estados',
    options: STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  };

  const columns: ReadonlyArray<DataTableColumn<SupplyRequestView>> = [
    {
      id: 'solicitante',
      header: 'Solicitante',
      render: (r) =>
        r.requester ? (
          <span className="font-medium">
            {r.requester.firstName} {r.requester.lastName}
          </span>
        ) : (
          <span className="text-muted-foreground">Usuario eliminado</span>
        ),
    },
    {
      id: 'fecha',
      header: 'Fecha',
      sortable: true,
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    {
      id: 'items',
      header: 'Ítems',
      className: 'max-w-[260px]',
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-sm">
            {r.items.length} {r.items.length === 1 ? 'ítem' : 'ítems'}
          </span>
          <span className="truncate text-xs text-muted-foreground" title={itemsSummary(r)}>
            {itemsSummary(r)}
          </span>
        </div>
      ),
    },
    {
      id: 'estado',
      header: 'Estado',
      sortable: true,
      render: (r) => <RequestStatusBadge status={r.status} />,
    },
  ];

  const rowActions = (r: SupplyRequestView): ReactNode =>
    r.status === 'PENDIENTE' ? (
      <>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setToDeliver(r)}>
          Entregar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => setToReject(r)}
        >
          Rechazar
        </Button>
      </>
    ) : null;

  return (
    <>
      <DataTable<SupplyRequestView>
        table={table}
        columns={columns}
        getRowId={(r) => r.id}
        filters={[statusFilter]}
        rowActions={rowActions}
        emptyMessage="No hay solicitudes de insumos que coincidan con el filtro."
        caption="Solicitudes de insumos"
      />

      <DeliverRequestDialog
        request={toDeliver}
        warehousesState={warehousesState}
        onReloadWarehouses={onReloadWarehouses}
        onOpenChange={(next) => (next ? undefined : setToDeliver(null))}
        onDelivered={() => table.refetch()}
      />

      <RejectRequestDialog
        request={toReject}
        onOpenChange={(next) => (next ? undefined : setToReject(null))}
        onRejected={() => table.refetch()}
      />
    </>
  );
}

/* --------------------------------------------------------------------------
   Diálogo ENTREGAR: ítems solicitados + bodega origen + nota opcional.
   El 400 de stock insuficiente del backend se muestra tal cual, inline.
   -------------------------------------------------------------------------- */

function DeliverRequestDialog({
  request,
  warehousesState,
  onReloadWarehouses,
  onOpenChange,
  onDelivered,
}: {
  request: SupplyRequestView | null;
  warehousesState: WarehousesState;
  onReloadWarehouses: () => void;
  onOpenChange: (open: boolean) => void;
  onDelivered: () => void;
}): ReactNode {
  const baseId = useId();
  const open = request !== null;

  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-siembra síncrona al abrir con otra solicitud.
  const openKey = request?.id ?? null;
  if (openKey !== null && openKey !== seededKey) {
    setWarehouseId('');
    setNote('');
    setError(null);
    setSeededKey(openKey);
  }
  if (openKey === null && seededKey !== null) {
    setSeededKey(null);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!request) return;
    if (warehouseId.length === 0) {
      setError('Selecciona la bodega de origen.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await deliverSupplyRequest(request.id, {
        warehouseId,
        note: note.trim() || undefined,
      });
      toast.success('Solicitud entregada con éxito.');
      onDelivered();
      onOpenChange(false);
    } catch (err) {
      // El 400 de stock insuficiente trae el detalle por ítem: se muestra tal cual.
      setError(errorToMessage(err, 'No se pudo entregar la solicitud.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Entregar solicitud</ModalTitle>
          <ModalDescription>
            Confirma la entrega de los insumos solicitados. El stock se descuenta de la bodega que
            elijas.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Ítems solicitados</p>
            <ul className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 p-3 text-sm">
              {request?.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <span>
                    {item.supplyName}{' '}
                    <span className="font-mono text-xs text-muted-foreground">({item.supplyCode})</span>
                  </span>
                  <span className="font-mono text-xs">
                    {item.quantity} {item.unit}
                  </span>
                </li>
              ))}
            </ul>
            {request?.note && (
              <p className="text-xs text-muted-foreground">Nota del solicitante: {request.note}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-warehouse`}>Bodega de origen</Label>
            <Select
              id={`${baseId}-warehouse`}
              aria-label="Bodega de origen de la entrega"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              disabled={warehousesState.status !== 'ready'}
              required
            >
              <option value="">
                {warehousesState.status === 'loading'
                  ? 'Cargando bodegas…'
                  : 'Selecciona una bodega'}
              </option>
              {warehousesState.list.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </Select>
            {warehousesState.status === 'error' && (
              <div className="flex items-center gap-2" role="alert">
                <p className="text-xs text-destructive">No se pudieron cargar las bodegas.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onReloadWarehouses}
                >
                  Reintentar
                </Button>
              </div>
            )}
            {warehousesState.status === 'ready' && warehousesState.list.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay bodegas registradas. Crea una en la pestaña Bodegas.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-note`}>Nota (opcional)</Label>
            <Textarea
              id={`${baseId}-note`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej. Entregado en bodega central."
            />
          </div>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <ModalFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Confirmar entrega
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

/* --------------------------------------------------------------------------
   Diálogo RECHAZAR: motivo opcional.
   -------------------------------------------------------------------------- */

function RejectRequestDialog({
  request,
  onOpenChange,
  onRejected,
}: {
  request: SupplyRequestView | null;
  onOpenChange: (open: boolean) => void;
  onRejected: () => void;
}): ReactNode {
  const baseId = useId();
  const open = request !== null;

  const [reason, setReason] = useState('');
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openKey = request?.id ?? null;
  if (openKey !== null && openKey !== seededKey) {
    setReason('');
    setError(null);
    setSeededKey(openKey);
  }
  if (openKey === null && seededKey !== null) {
    setSeededKey(null);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!request) return;
    setError(null);
    setSaving(true);
    try {
      await rejectSupplyRequest(request.id, { reason: reason.trim() || undefined });
      toast.success('Solicitud rechazada.');
      onRejected();
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo rechazar la solicitud.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Rechazar solicitud</ModalTitle>
          <ModalDescription>
            El solicitante verá la solicitud como rechazada, junto con el motivo si lo indicas.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-reason`}>Motivo (opcional)</Label>
            <Textarea
              id={`${baseId}-reason`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Sin stock disponible por ahora."
            />
          </div>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <ModalFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Rechazar solicitud
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

/* --------------------------------------------------------------------------
   Sub-vista HISTORIAL: todas las entregas registradas (motor de tablas).
   -------------------------------------------------------------------------- */

function AssignmentsHistoryView({
  warehousesState,
  onReloadWarehouses,
}: {
  warehousesState: WarehousesState;
  onReloadWarehouses: () => void;
}): ReactNode {
  const fetcher = useCallback((req: TableRequest) => fetchAssignmentsTable(req), []);
  const table = useDataTable<SupplyAssignmentView>(fetcher, {
    initialSortBy: 'fecha',
    initialSortDir: 'desc',
  });

  const warehouseName = (id: string | null): string | null => {
    if (!id) return null;
    const found = warehousesState.list.find((w) => w.id === id);
    return found ? `${found.name} (${found.code})` : null;
  };

  const columns: ReadonlyArray<DataTableColumn<SupplyAssignmentView>> = [
    {
      id: 'trabajador',
      header: 'Trabajador',
      render: (a) =>
        a.worker ? (
          <span className="font-medium">
            {a.worker.firstName} {a.worker.lastName}
          </span>
        ) : (
          <span className="text-muted-foreground">Usuario eliminado</span>
        ),
    },
    {
      id: 'articulo',
      header: 'Artículo',
      render: (a) => (
        <div className="flex items-center gap-2">
          <span className="text-sm">{a.supplyName}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {a.supplyCode}
          </Badge>
        </div>
      ),
    },
    {
      id: 'cantidad',
      header: 'Cantidad',
      sortable: true,
      className: 'text-right',
      render: (a) => (
        <span className="font-mono text-sm">
          {a.quantity} <span className="text-xs text-muted-foreground">{a.unit}</span>
        </span>
      ),
    },
    {
      id: 'bodega',
      header: 'Bodega',
      render: (a) => {
        if (!a.warehouseId) return <span className="text-muted-foreground">Sin bodega</span>;
        const name = warehouseName(a.warehouseId);
        if (name) return name;
        // Hay bodega asociada pero el listado aún no está disponible
        // (cargando o falló): no confundir con "sin bodega".
        return (
          <span className="text-muted-foreground">
            {warehousesState.status === 'ready' ? 'Sin bodega' : 'Sin datos de bodega'}
          </span>
        );
      },
    },
    {
      id: 'entregadoPor',
      header: 'Entregado por',
      render: (a) =>
        a.deliveredBy ? (
          `${a.deliveredBy.firstName} ${a.deliveredBy.lastName}`
        ) : (
          <span className="text-muted-foreground">Sin registro</span>
        ),
    },
    {
      id: 'fecha',
      header: 'Fecha',
      sortable: true,
      render: (a) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(a.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {warehousesState.status === 'error' && (
        <Alert variant="warning" live>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">
              No se pudieron cargar las bodegas: la columna Bodega se muestra sin datos.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={onReloadWarehouses}
            >
              Reintentar
            </Button>
          </div>
        </Alert>
      )}
      <DataTable<SupplyAssignmentView>
        table={table}
        columns={columns}
        getRowId={(a) => a.id}
        searchable
        searchPlaceholder="Buscar por artículo o trabajador…"
        emptyMessage="Aún no hay entregas registradas."
        caption="Historial completo de entregas de insumos"
      />
    </div>
  );
}
