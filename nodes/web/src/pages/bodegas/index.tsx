import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  Building,
  Plus,
  MapPin,
  Package,
  Boxes,
  Loader2,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useHasPermission } from '@/hooks/use-has-permission';
import {
  listWarehouses,
  getWarehouseById,
  createWarehouse,
  errorToMessage,
  type WarehouseView,
  type WarehouseStockView,
  type WarehouseTransactionView,
} from '@/lib/api';

interface WarehouseDetail {
  warehouse: WarehouseView;
  stocks: WarehouseStockView[];
  transactions: WarehouseTransactionView[];
}

/**
 * Vista dedicada de Bodegas (warehouses) para la sub-pestaña "bodegas" de
 * Recursos. Lista las bodegas de la organización y, al seleccionar una, muestra
 * su stock actual (insumo / cantidad / unidad) y sus movimientos recientes.
 *
 * El botón "Nueva bodega" se gatea en la UI por el MISMO permiso que usa la
 * pestaña padre (`canManageSupplyChain`, ver `pages/recursos/index.tsx`):
 * `warehouse:access`. La autorización real la aplica el backend (`warehouse:access`,
 * ver `warehouses.controller.ts`); este gating solo decide si se muestra la acción.
 */
export default function BodegasPage(): ReactNode {
  const canManageSupplyChain = useHasPermission('warehouse:access');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Lista de bodegas
  const [warehouses, setWarehouses] = useState<WarehouseView[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Bodega seleccionada + su detalle (stock + movimientos)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WarehouseDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Modal "Nueva bodega"
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchWarehouses = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const data = await listWarehouses();
      if (!mountedRef.current) return;
      setWarehouses(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setListError(errorToMessage(err, 'Error al cargar las bodegas.'));
    } finally {
      if (mountedRef.current) setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void fetchWarehouses();
  }, [fetchWarehouses]);

  const fetchDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const data = await getWarehouseById(id);
      if (!mountedRef.current) return;
      setDetail(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setDetailError(errorToMessage(err, 'Error al cargar el detalle de la bodega.'));
    } finally {
      if (mountedRef.current) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      void fetchDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  const handleOpenCreate = () => {
    setCode('');
    setName('');
    setLocation('');
    setFormError(null);
    setCreateOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!code.trim() || !name.trim()) {
      setFormError('El código y el nombre son obligatorios.');
      return;
    }
    if (code.trim().length > 4) {
      setFormError('El código no puede superar los 4 caracteres.');
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const created = await createWarehouse({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        location: location.trim() || undefined,
      });
      if (!mountedRef.current) return;
      setCreateOpen(false);
      // Refrescamos la lista y seleccionamos la bodega recién creada.
      await fetchWarehouses();
      if (mountedRef.current) setSelectedId(created.id);
    } catch (err) {
      if (mountedRef.current) {
        setFormError(errorToMessage(err, 'Error al crear la bodega.'));
      }
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Panel izquierdo: lista de bodegas */}
      <div className="lg:col-span-1">
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building className="size-5 text-primary" />
                Bodegas
              </CardTitle>
              {canManageSupplyChain && (
                <Button size="sm" onClick={handleOpenCreate}>
                  <Plus className="mr-1.5 size-4" />
                  Nueva bodega
                </Button>
              )}
            </div>
            <CardDescription>
              Selecciona una bodega para ver su stock y movimientos.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {loadingList ? (
              <LoadingState rows={4} label="Cargando bodegas…" />
            ) : listError ? (
              <ErrorState message={listError} onRetry={() => void fetchWarehouses()} />
            ) : warehouses.length === 0 ? (
              <EmptyState
                icon={Building}
                title="No hay bodegas"
                message={
                  canManageSupplyChain
                    ? 'Crea la primera bodega con el botón "Nueva bodega".'
                    : 'Aún no se han registrado bodegas en la organización.'
                }
              />
            ) : (
              <div className="flex max-h-[520px] flex-col gap-1.5 overflow-y-auto pr-1">
                {warehouses.map((wh) => {
                  const active = wh.id === selectedId;
                  return (
                    <button
                      key={wh.id}
                      type="button"
                      onClick={() => setSelectedId(wh.id)}
                      className={`flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-all ${
                        active
                          ? 'border-primary/50 bg-primary/5 text-foreground shadow-sm'
                          : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{wh.name}</span>
                        <Badge variant="outline" className="h-5 font-mono text-[10px]">
                          {wh.code}
                        </Badge>
                      </div>
                      {wh.location && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
                          <MapPin className="size-3" />
                          {wh.location}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Panel derecho: detalle de la bodega seleccionada */}
      <div className="lg:col-span-2 flex flex-col gap-6">
        {!selectedId ? (
          <Card className="border-border/60 bg-card/40">
            <CardContent className="py-16">
              <EmptyState
                icon={Boxes}
                title="Ninguna bodega seleccionada"
                message="Selecciona una bodega de la lista para ver su stock actual y su historial de movimientos."
              />
            </CardContent>
          </Card>
        ) : loadingDetail ? (
          <Card className="border-border/60 bg-card/40">
            <CardContent className="py-6">
              <LoadingState label="Cargando detalle de la bodega…" />
            </CardContent>
          </Card>
        ) : detailError ? (
          <ErrorState message={detailError} onRetry={() => void fetchDetail(selectedId)} />
        ) : detail ? (
          <>
            {/* Encabezado de la bodega */}
            <div className="flex flex-col gap-3 rounded-xl border border-border/65 bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Boxes className="size-6" />
                </div>
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                    {detail.warehouse.name}
                    <Badge
                      variant="outline"
                      className="border-primary/30 bg-primary/5 font-mono text-xs text-primary"
                    >
                      {detail.warehouse.code}
                    </Badge>
                  </h2>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" />
                    {detail.warehouse.location || 'Ubicación no especificada'}
                  </p>
                </div>
              </div>
            </div>

            {/* Stock actual */}
            <Card className="border-border/60 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <Package className="size-4 text-primary" />
                  Stock actual
                </CardTitle>
                <CardDescription>
                  Existencias de insumos registradas en esta bodega.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {detail.stocks.length === 0 ? (
                  <EmptyState
                    icon={Package}
                    title="Sin existencias"
                    message="Esta bodega todavía no tiene stock registrado."
                  />
                ) : (
                  <div className="max-h-[360px] overflow-y-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Insumo</TableHead>
                          <TableHead>Código</TableHead>
                          <TableHead>Categoría</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead className="text-right">Unidad</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.stocks.map((stock) => (
                          <TableRow key={stock.supplyId} className="hover:bg-muted/30">
                            <TableCell>
                              <div className="flex flex-col gap-0.5">
                                <span className="text-xs font-semibold">
                                  {stock.supply?.name ?? 'Insumo desconocido'}
                                </span>
                                {stock.supply?.description && (
                                  <span className="max-w-[220px] truncate text-[10px] text-muted-foreground">
                                    {stock.supply.description}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {stock.supply?.code ?? '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="h-5 text-[9px] font-medium">
                                {stock.supply?.category || 'Sin categoría'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold">
                              {stock.quantity}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {stock.supply?.unit ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Movimientos recientes */}
            <Card className="border-border/60 bg-card/70">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <History className="size-4 text-primary" />
                  Movimientos recientes
                </CardTitle>
                <CardDescription>
                  Registro cronológico de ingresos y egresos de esta bodega.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {detail.transactions.length === 0 ? (
                  <EmptyState message="No hay movimientos registrados en esta bodega." />
                ) : (
                  <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Insumo</TableHead>
                          <TableHead>Movimiento</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead>Responsable</TableHead>
                          <TableHead>Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.transactions.map((tx) => (
                          <TableRow key={tx.id} className="hover:bg-muted/30">
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {new Date(tx.createdAt).toLocaleString('es-CL', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold">
                                  {tx.supply?.name ?? 'Insumo desconocido'}
                                </span>
                                {tx.supply?.code && (
                                  <Badge variant="outline" className="h-4 font-mono text-[9px]">
                                    {tx.supply.code}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {tx.type === 'ENTRY' ? (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-500/30 bg-emerald-500/5 px-2 text-[10px] font-bold text-emerald-500"
                                >
                                  Ingreso
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/30 bg-amber-500/5 px-2 text-[10px] font-bold text-amber-500"
                                >
                                  Egreso
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold">
                              {tx.type === 'ENTRY' ? '+' : '-'}
                              {tx.quantity}{' '}
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {tx.supply?.unit}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs font-medium text-foreground/80">
                              {tx.actor ? `${tx.actor.firstName} ${tx.actor.lastName}` : 'Sistema'}
                            </TableCell>
                            <TableCell
                              className="max-w-[200px] truncate text-xs text-muted-foreground"
                              title={tx.reason || ''}
                            >
                              {tx.reason || '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {/* Modal: Nueva bodega */}
      {createOpen && canManageSupplyChain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-md border border-border bg-card shadow-lg">
            <form onSubmit={handleCreate}>
              <CardHeader>
                <CardTitle>Nueva bodega</CardTitle>
                <CardDescription>
                  Registra una nueva bodega para gestionar su inventario de insumos.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {formError && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                    {formError}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-code">Código (máx. 4 caracteres)</Label>
                  <Input
                    id="wh-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={4}
                    placeholder="B01"
                    className="font-mono uppercase"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-name">Nombre</Label>
                  <Input
                    id="wh-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Bodega Central"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-location">Ubicación (opcional)</Label>
                  <Input
                    id="wh-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Santiago Centro"
                  />
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                      Creando…
                    </>
                  ) : (
                    'Crear bodega'
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
