import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ClipboardList, Loader2, Package, Plus, Trash2 } from 'lucide-react';
import type {
  InventoryCatalogItem,
  SupplyAssignmentView,
  SupplyRequestView,
} from '@gmt-platform/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { RequestStatusBadge } from '@/components/inventory/request-status';
import { formatDateTime } from '@/lib/format';
import {
  createMySupplyRequest,
  errorToMessage,
  fetchInventoryCatalog,
  fetchMyAssignments,
  fetchMyRequests,
} from '@/lib/api';

/**
 * Panel "Insumos" de Recursos, para CUALQUIER usuario: sus insumos entregados
 * (comprobante de qué se le entregó y cuándo), sus solicitudes con estado, y el
 * flujo "Solicitar insumos" contra el catálogo liviano de Inventario. La gestión
 * (entregar/rechazar, historial completo) vive en el módulo Inventario.
 */
export function MisInsumos(): ReactNode {
  const [assignments, setAssignments] = useState<SupplyAssignmentView[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);

  const [requests, setRequests] = useState<SupplyRequestView[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  const [requestOpen, setRequestOpen] = useState(false);

  const loadAssignments = useCallback(async () => {
    setLoadingAssignments(true);
    setAssignmentsError(null);
    try {
      setAssignments(await fetchMyAssignments());
    } catch (err) {
      setAssignmentsError(errorToMessage(err, 'No se pudieron cargar tus insumos.'));
    } finally {
      setLoadingAssignments(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    setRequestsError(null);
    try {
      setRequests(await fetchMyRequests());
    } catch (err) {
      setRequestsError(errorToMessage(err, 'No se pudieron cargar tus solicitudes.'));
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    void loadAssignments();
    void loadRequests();
  }, [loadAssignments, loadRequests]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Package className="size-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Mis insumos</h2>
            <p className="text-xs text-muted-foreground">
              Revisa lo que se te ha entregado y solicita los insumos que necesitas.
            </p>
          </div>
        </div>
        <Button onClick={() => setRequestOpen(true)}>
          <Plus aria-hidden />
          Solicitar insumos
        </Button>
      </div>

      {/* Mis insumos entregados: comprobante del trabajador. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Insumos entregados</CardTitle>
          <CardDescription>
            Tu comprobante de entregas: qué se te entregó, cuánto, cuándo y quién lo entregó.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingAssignments ? (
            <LoadingState label="Cargando tus insumos…" />
          ) : assignmentsError ? (
            <ErrorState message={assignmentsError} onRetry={() => void loadAssignments()} />
          ) : assignments.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Aún no tienes insumos entregados"
              message="Cuando logística entregue una solicitud tuya, el detalle quedará registrado aquí."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <caption className="sr-only">Mis insumos entregados</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artículo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Entregado por</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.supplyName}</span>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {a.supplyCode}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {a.quantity}{' '}
                        <span className="text-xs text-muted-foreground">{a.unit}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(a.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.deliveredBy ? (
                          `${a.deliveredBy.firstName} ${a.deliveredBy.lastName}`
                        ) : (
                          <span className="text-muted-foreground">Sin registro</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mis solicitudes de insumos. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mis solicitudes</CardTitle>
          <CardDescription>
            El estado de tus solicitudes de insumos. Las rechazadas muestran el motivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRequests ? (
            <LoadingState label="Cargando tus solicitudes…" />
          ) : requestsError ? (
            <ErrorState message={requestsError} onRetry={() => void loadRequests()} />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Aún no tienes solicitudes"
              message="Usa el botón Solicitar insumos para pedir lo que necesitas."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {requests.map((r) => (
                <li key={r.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </span>
                    <RequestStatusBadge status={r.status} />
                  </div>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {r.items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-3">
                        <span>
                          {item.supplyName}{' '}
                          <span className="font-mono text-xs text-muted-foreground">
                            ({item.supplyCode})
                          </span>
                        </span>
                        <span className="font-mono text-xs">
                          {item.quantity} {item.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {r.note && (
                    <p className="mt-2 text-xs text-muted-foreground">Nota: {r.note}</p>
                  )}
                  {r.status === 'RECHAZADA' && (
                    <p className="mt-2 text-xs text-destructive">
                      Motivo del rechazo: {r.rejectionReason || 'Sin motivo indicado.'}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RequestSuppliesDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        onCreated={() => void loadRequests()}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------
   Diálogo "Solicitar insumos": filas dinámicas (artículo + cantidad) + nota.
   -------------------------------------------------------------------------- */

interface RequestRowState {
  key: string;
  supplyId: string;
  quantity: string;
}

function newRowKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function emptyRow(): RequestRowState {
  return { key: newRowKey(), supplyId: '', quantity: '1' };
}

function RequestSuppliesDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): ReactNode {
  const baseId = useId();

  const [rows, setRows] = useState<RequestRowState[]>([emptyRow()]);
  const [note, setNote] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<InventoryCatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Re-siembra síncrona al abrir.
  if (open && !seeded) {
    setRows([emptyRow()]);
    setNote('');
    setError(null);
    setSeeded(true);
  }
  if (!open && seeded) {
    setSeeded(false);
  }

  // Catálogo liviano al abrir el diálogo.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingCatalog(true);
    setCatalogError(null);
    fetchInventoryCatalog()
      .then((items) => {
        if (!cancelled) setCatalog(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCatalogError(errorToMessage(err, 'No se pudo cargar el catálogo de artículos.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function updateRow(key: string, patch: Partial<RequestRowState>): void {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(key: string): void {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.key !== key) : prev));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();

    const items: Array<{ supplyId: string; quantity: number }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.supplyId.length === 0) {
        setError('Selecciona un artículo en cada fila (o quita la fila).');
        return;
      }
      if (seen.has(row.supplyId)) {
        setError('No repitas el mismo artículo en más de una fila; ajusta la cantidad en una sola.');
        return;
      }
      seen.add(row.supplyId);
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError('Cada cantidad debe ser un número mayor a cero.');
        return;
      }
      items.push({ supplyId: row.supplyId, quantity });
    }
    if (items.length === 0) {
      setError('Agrega al menos un artículo a la solicitud.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await createMySupplyRequest({ note: note.trim() || undefined, items });
      toast.success('Solicitud de insumos enviada.');
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo enviar la solicitud.'));
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
      <ModalContent className="sm:max-w-xl">
        <ModalHeader>
          <ModalTitle>Solicitar insumos</ModalTitle>
          <ModalDescription>
            Elige los artículos y las cantidades que necesitas. Logística revisará tu solicitud.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          {catalogError && (
            <Alert variant="destructive" live>
              {catalogError}
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              {/* No es un <label>: no hay un control único que etiquetar (cada
                  fila tiene sus propios labels). */}
              <span className="text-sm font-medium leading-none text-foreground select-none">
                Artículos
              </span>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus aria-hidden />
                Agregar artículo
              </Button>
            </div>

            <ul className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <li key={row.key} className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor={`${baseId}-supply-${row.key}`} className="text-xs">
                      Artículo {index + 1}
                    </Label>
                    <Select
                      id={`${baseId}-supply-${row.key}`}
                      aria-label={`Artículo ${index + 1}`}
                      value={row.supplyId}
                      onChange={(e) => updateRow(row.key, { supplyId: e.target.value })}
                      disabled={loadingCatalog}
                    >
                      <option value="">
                        {loadingCatalog ? 'Cargando catálogo…' : 'Selecciona un artículo'}
                      </option>
                      {catalog.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex w-24 flex-col gap-1">
                    <Label htmlFor={`${baseId}-qty-${row.key}`} className="text-xs">
                      Cantidad
                    </Label>
                    <Input
                      id={`${baseId}-qty-${row.key}`}
                      type="number"
                      min={1}
                      step="any"
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length === 1}
                    aria-label={`Quitar el artículo ${index + 1}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {!loadingCatalog && !catalogError && catalog.length === 0 && (
              <p className="text-xs text-muted-foreground">
                El catálogo de artículos está vacío. Contacta a logística.
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
              placeholder="Ej. Los necesito para la faena del lunes."
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
            <Button type="submit" disabled={saving || loadingCatalog}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Enviar solicitud
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
