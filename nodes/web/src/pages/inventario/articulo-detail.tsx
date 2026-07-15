import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Building, ExternalLink, Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  InventoryItemDetail,
  SupplyProviderLinkView,
} from '@gmt-platform/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
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
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import {
  addSupplyProviderLink,
  errorToMessage,
  getInventoryItemDetail,
  listProviders,
  removeSupplyProviderLink,
  updateInventoryItem,
  updateSupplyProviderLink,
  type ProviderView,
  type UpdateInventoryItemInput,
} from '@/lib/api';

/** Formateador CLP sin decimales para el precio referencial del proveedor. */
const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

type DetailTab = 'detalle' | 'stock' | 'proveedores';

const DETAIL_TABS: ReadonlyArray<TabItem<DetailTab>> = [
  { value: 'detalle', label: 'Detalle', icon: Pencil },
  { value: 'stock', label: 'Stock', icon: Package },
  { value: 'proveedores', label: 'Proveedores', icon: Building },
];

/**
 * Detalle inline de un artículo (patrón master-detail de Recursos): header con
 * nombre, código y badges + 3 pestañas: DETALLE (formulario editable de los
 * descriptivos), STOCK (existencias por bodega con fila TOTAL) y PROVEEDORES
 * (vínculos con precio CLP y URL, con alta/edición/quitar).
 */
export function ArticuloDetail({ id, onBack }: { id: string; onBack: () => void }): ReactNode {
  const [detail, setDetail] = useState<InventoryItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('detalle');
  const idBase = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDetail(await getInventoryItemDetail(id));
    } catch (err) {
      setLoadError(errorToMessage(err, 'No se pudo cargar el detalle del artículo.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <LoadingState label="Cargando detalle del artículo…" rows={6} />;
  }

  if (loadError || !detail) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden />
            Volver
          </Button>
        </div>
        <ErrorState
          message={loadError ?? 'No se pudo cargar el detalle del artículo.'}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header con botón volver + identidad del artículo. */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver al catálogo">
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{detail.name}</h2>
            <Badge variant="outline" className="font-mono">
              {detail.code}
            </Badge>
            {detail.category && <Badge variant="secondary">{detail.category}</Badge>}
            {detail.brand && <Badge variant="neutral">{detail.brand}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Ficha del artículo: detalle descriptivo, existencias por bodega y proveedores.
          </p>
        </div>
      </div>

      <Tabs<DetailTab>
        aria-label="Secciones del detalle del artículo"
        items={DETAIL_TABS}
        value={activeTab}
        onValueChange={setActiveTab}
        idBase={idBase}
      />

      <div
        role="tabpanel"
        id={tabPanelId(idBase, activeTab)}
        aria-labelledby={tabTriggerId(idBase, activeTab)}
        tabIndex={0}
      >
        {activeTab === 'detalle' && (
          <DetalleForm detail={detail} onSaved={(next) => setDetail((prev) => (prev ? { ...prev, ...next } : prev))} />
        )}
        {activeTab === 'stock' && <StockPanel detail={detail} />}
        {activeTab === 'proveedores' && <ProveedoresPanel detail={detail} onChanged={() => void load()} />}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Pestaña DETALLE: formulario editable de los descriptivos (PATCH).
   -------------------------------------------------------------------------- */

interface DetalleFormState {
  name: string;
  brand: string;
  category: string;
  color: string;
  size: string;
  model: string;
  unit: string;
  description: string;
}

function seedForm(detail: InventoryItemDetail): DetalleFormState {
  return {
    name: detail.name,
    brand: detail.brand ?? '',
    category: detail.category ?? '',
    color: detail.color ?? '',
    size: detail.size ?? '',
    model: detail.model ?? '',
    unit: detail.unit,
    description: detail.description ?? '',
  };
}

function DetalleForm({
  detail,
  onSaved,
}: {
  detail: InventoryItemDetail;
  onSaved: (next: Partial<InventoryItemDetail>) => void;
}): ReactNode {
  const baseId = useId();
  const [form, setForm] = useState<DetalleFormState>(() => seedForm(detail));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof DetalleFormState>(key: K, value: DetalleFormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (form.name.trim().length === 0) {
      setError('El nombre es obligatorio.');
      return;
    }
    setError(null);
    setSaving(true);
    // Los opcionales viajan SIEMPRE (string vacío incluido): el backend limpia
    // el campo con '' y lo conserva solo si la clave no viaja. Con `|| undefined`
    // sería imposible vaciar un campo ya guardado.
    const input: UpdateInventoryItemInput = {
      name: form.name.trim(),
      brand: form.brand.trim(),
      category: form.category.trim(),
      color: form.color.trim(),
      size: form.size.trim(),
      model: form.model.trim(),
      unit: form.unit.trim(),
      description: form.description.trim(),
    };
    try {
      const saved = await updateInventoryItem(detail.id, input);
      toast.success('Artículo actualizado con éxito.');
      onSaved(saved);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar el artículo.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Detalle del artículo</CardTitle>
        <CardDescription>
          Edita los campos descriptivos y guarda los cambios. El código no es editable.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-code`}>Código</Label>
              <Input id={`${baseId}-code`} value={detail.code} className="font-mono" disabled />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${baseId}-name`}>Nombre</Label>
              <Input
                id={`${baseId}-name`}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-brand`}>Marca</Label>
              <Input
                id={`${baseId}-brand`}
                value={form.brand}
                onChange={(e) => update('brand', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-category`}>Tipo</Label>
              <Input
                id={`${baseId}-category`}
                value={form.category}
                onChange={(e) => update('category', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-color`}>Color</Label>
              <Input
                id={`${baseId}-color`}
                value={form.color}
                onChange={(e) => update('color', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-size`}>Talla</Label>
              <Input
                id={`${baseId}-size`}
                value={form.size}
                onChange={(e) => update('size', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-model`}>Modelo</Label>
              <Input
                id={`${baseId}-model`}
                value={form.model}
                onChange={(e) => update('model', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-unit`}>Unidad de medida</Label>
              <Input
                id={`${baseId}-unit`}
                value={form.unit}
                onChange={(e) => update('unit', e.target.value)}
                placeholder="Ej. unidades"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-desc`}>Descripción</Label>
            <Textarea
              id={`${baseId}-desc`}
              rows={3}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Descripción del artículo (opcional)."
            />
          </div>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Guardar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------------------
   Pestaña STOCK: existencias por bodega + fila TOTAL destacada.
   -------------------------------------------------------------------------- */

function StockPanel({ detail }: { detail: InventoryItemDetail }): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Existencias por bodega</CardTitle>
        <CardDescription>
          Stock actual del artículo en cada bodega. Los movimientos se registran en la pestaña
          Bodegas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {detail.stocks.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Sin existencias registradas"
            message="Este artículo aún no tiene stock en ninguna bodega."
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <caption className="sr-only">Existencias del artículo por bodega</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Bodega</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.stocks.map((stock) => (
                  <TableRow key={stock.warehouseId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{stock.warehouseName}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {stock.warehouseCode}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {stock.quantity}{' '}
                      <span className="text-xs text-muted-foreground">{detail.unit}</span>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right font-mono">
                    {detail.totalStock}{' '}
                    <span className="text-xs font-normal text-muted-foreground">{detail.unit}</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------------------
   Pestaña PROVEEDORES: vínculos artículo-proveedor (precio CLP + URL).
   -------------------------------------------------------------------------- */

function ProveedoresPanel({
  detail,
  onChanged,
}: {
  detail: InventoryItemDetail;
  onChanged: () => void;
}): ReactNode {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<SupplyProviderLinkView | null>(null);
  const [toRemove, setToRemove] = useState<SupplyProviderLinkView | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Proveedores vinculados</CardTitle>
          <CardDescription>
            Precio referencial (CLP) y URL del producto por proveedor.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingLink(null);
            setLinkDialogOpen(true);
          }}
        >
          <Plus aria-hidden />
          Agregar proveedor
        </Button>
      </CardHeader>
      <CardContent>
        {detail.providers.length === 0 ? (
          <EmptyState
            icon={Building}
            title="Sin proveedores vinculados"
            message="Agrega un proveedor para registrar su precio referencial y la URL del producto."
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <caption className="sr-only">Proveedores vinculados al artículo</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.providers.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium">{link.providerName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {link.price !== null ? (
                        clpFormatter.format(link.price)
                      ) : (
                        <span className="font-sans text-muted-foreground">Sin precio</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {link.url ? (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-[220px] items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                        >
                          <span className="truncate">{link.url}</span>
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin URL</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => {
                            setEditingLink(link);
                            setLinkDialogOpen(true);
                          }}
                        >
                          <Pencil aria-hidden />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => setToRemove(link)}
                          aria-label={`Quitar el vínculo con ${link.providerName}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ProviderLinkDialog
        open={linkDialogOpen}
        itemId={detail.id}
        linkedProviderIds={detail.providers.map((p) => p.providerId)}
        editing={editingLink}
        onOpenChange={(next) => {
          setLinkDialogOpen(next);
          if (!next) setEditingLink(null);
        }}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(next) => (next ? undefined : setToRemove(null))}
        title="Quitar proveedor"
        description={
          <>
            ¿Seguro que quieres quitar el vínculo con{' '}
            <span className="font-medium text-foreground">{toRemove?.providerName}</span>? Esta
            acción no elimina al proveedor, solo su vínculo con este artículo.
          </>
        }
        confirmLabel="Quitar vínculo"
        onConfirm={async () => {
          if (toRemove) {
            await removeSupplyProviderLink(detail.id, toRemove.id);
            toast.success('Vínculo con el proveedor eliminado.');
            onChanged();
          }
        }}
      />
    </Card>
  );
}

/* --------------------------------------------------------------------------
   Diálogo de vínculo artículo-proveedor (crear + editar precio/URL).
   -------------------------------------------------------------------------- */

interface LinkFormState {
  providerId: string;
  price: string;
  url: string;
}

function ProviderLinkDialog({
  open,
  itemId,
  linkedProviderIds,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  itemId: string;
  /** Proveedores ya vinculados (se excluyen del select en modo crear). */
  linkedProviderIds: string[];
  /** Vínculo en edición; `null` = crear uno nuevo. */
  editing: SupplyProviderLinkView | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactNode {
  const baseId = useId();
  const isEdit = editing !== null;

  const [form, setForm] = useState<LinkFormState>({ providerId: '', price: '', url: '' });
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // Re-siembra síncrona al abrir (crear o editar otro vínculo).
  const openKey = open ? (editing?.id ?? 'new') : null;
  if (openKey !== null && openKey !== seededKey) {
    setForm({
      providerId: editing?.providerId ?? '',
      price: editing?.price !== null && editing?.price !== undefined ? String(editing.price) : '',
      url: editing?.url ?? '',
    });
    setError(null);
    setSeededKey(openKey);
  }
  if (openKey === null && seededKey !== null) {
    setSeededKey(null);
  }

  // Carga de proveedores para el select (solo en modo crear, al abrir).
  useEffect(() => {
    if (!open || isEdit) return;
    let cancelled = false;
    setLoadingProviders(true);
    setProvidersError(null);
    listProviders()
      .then((list) => {
        if (!cancelled) setProviders(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setProvidersError(errorToMessage(err, 'No se pudieron cargar los proveedores.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isEdit]);

  const availableProviders = providers.filter((p) => !linkedProviderIds.includes(p.id));

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedPrice = form.price.trim();
    // null = limpiar el precio (input vacío en edición); number = fijarlo.
    let price: number | null = null;
    if (trimmedPrice.length > 0) {
      const parsed = Number(trimmedPrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('El precio debe ser un número mayor o igual a cero.');
        return;
      }
      price = Math.round(parsed);
    }
    if (!isEdit && form.providerId.length === 0) {
      setError('Selecciona un proveedor.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (isEdit && editing) {
        // En edición el precio y la URL viajan siempre: `price: null` limpia el
        // precio registrado y el string vacío limpia la URL server-side.
        await updateSupplyProviderLink(itemId, editing.id, { price, url: form.url.trim() });
        toast.success('Vínculo con el proveedor actualizado.');
      } else {
        await addSupplyProviderLink(itemId, {
          providerId: form.providerId,
          price: price ?? undefined,
          url: form.url.trim() || undefined,
        });
        toast.success('Proveedor vinculado con éxito.');
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar el vínculo con el proveedor.'));
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
          <ModalTitle>{isEdit ? 'Editar proveedor' : 'Agregar proveedor'}</ModalTitle>
          <ModalDescription>
            {isEdit
              ? `Actualiza el precio referencial o la URL del producto de ${editing?.providerName ?? 'este proveedor'}.`
              : 'Vincula un proveedor existente con su precio referencial (CLP) y la URL del producto.'}
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isEdit ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-provider-name`}>Proveedor</Label>
              <Input id={`${baseId}-provider-name`} value={editing?.providerName ?? ''} disabled />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-provider`}>Proveedor</Label>
              <Select
                id={`${baseId}-provider`}
                aria-label="Proveedor a vincular"
                value={form.providerId}
                onChange={(e) => setForm((prev) => ({ ...prev, providerId: e.target.value }))}
                disabled={loadingProviders}
                required
              >
                <option value="">
                  {loadingProviders ? 'Cargando proveedores…' : 'Selecciona un proveedor'}
                </option>
                {availableProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {!loadingProviders && !providersError && availableProviders.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No hay proveedores disponibles. Crea uno en la pestaña Proveedores.
                </p>
              )}
              {providersError && <p className="text-xs text-destructive">{providersError}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-price`}>Precio referencial (CLP, opcional)</Label>
            <Input
              id={`${baseId}-price`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
              placeholder="Ej. 15990"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-url`}>URL del producto (opcional)</Label>
            <Input
              id={`${baseId}-url`}
              type="url"
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="https://proveedor.cl/producto"
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
              {isEdit ? 'Guardar cambios' : 'Vincular proveedor'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
