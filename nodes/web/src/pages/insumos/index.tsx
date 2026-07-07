import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Package,
  Building,
  Plus,
  ArrowRightLeft,
  Search,
  FileSpreadsheet,
  History,
  MapPin,
  TrendingUp,
  Boxes,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { EmptyState, LoadingState } from '@/components/ui/states';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ImportWizard,
  type ImportTemplateColumn,
} from '@/components/primitives/import-wizard';
import {
  listWarehouses,
  getWarehouseById,
  createWarehouse,
  listSupplies,
  registerWarehouseTransaction,
  importSupplies,
  createSupply,
  type WarehouseView,
  type WarehouseStockView,
  type WarehouseTransactionView,
  type SupplyView,
} from '@/lib/api';

const TEMPLATE_COLUMNS: ImportTemplateColumn[] = [
  { key: 'code', label: 'Código', example: 'INS-BL01' },
  { key: 'name', label: 'Nombre', example: 'Pala de Punta' },
  { key: 'description', label: 'Descripción', example: 'Pala de acero reforzado mango de madera' },
  { key: 'category', label: 'Categoría', example: 'Herramientas de Mano' },
  { key: 'unit', label: 'Unidad de Medida', example: 'unidades' },
  { key: 'initialStock', label: 'Stock Inicial', example: '10' },
];

interface CsvRow {
  code: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  initialStock?: number;
}

export default function InsumosPage(): ReactNode {
  // Warehouse State
  const [warehouses, setWarehouses] = useState<WarehouseView[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [warehouseDetail, setWarehouseDetail] = useState<{
    warehouse: WarehouseView;
    stocks: WarehouseStockView[];
    transactions: WarehouseTransactionView[];
  } | null>(null);

  // Loading & Errors
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Warehouse Modal/Form State
  const [showCreateWarehouse, setShowCreateWarehouse] = useState(false);
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('');
  const [whLocation, setWhLocation] = useState('');
  const [creatingWh, setCreatingWh] = useState(false);

  // Supply Creation State
  const [showCreateSupply, setShowCreateSupply] = useState(false);
  const [supplyCode, setSupplyCode] = useState('');
  const [supplyName, setSupplyName] = useState('');
  const [supplyDesc, setSupplyDesc] = useState('');
  const [supplyCategory, setSupplyCategory] = useState('');
  const [supplyUnit, setSupplyUnit] = useState('unidades');
  const [creatingSupply, setCreatingSupply] = useState(false);

  // Transaction Ledger State
  const [txType, setTxType] = useState<'ENTRY' | 'EXIT'>('ENTRY');
  const [txQuantity, setTxQuantity] = useState<number>(0);
  const [txReason, setTxReason] = useState('');
  const [searchSupplyQuery, setSearchSupplyQuery] = useState('');
  const [suggestedSupplies, setSuggestedSupplies] = useState<SupplyView[]>([]);
  const [selectedSupply, setSelectedSupply] = useState<SupplyView | null>(null);
  const [registeringTx, setRegisteringTx] = useState(false);

  // Bulk Import
  const [importOpen, setImportOpen] = useState(false);

  // Filters for stocks list
  const [stockSearch, setStockSearch] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState('ALL');

  // Load initial list of warehouses
  const fetchWarehouses = useCallback(async () => {
    setLoadingWarehouses(true);
    setErrorMsg(null);
    try {
      const data = await listWarehouses();
      setWarehouses(data);
      if (data.length > 0 && !selectedWarehouseId && data[0]) {
        setSelectedWarehouseId(data[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al cargar bodegas');
    } finally {
      setLoadingWarehouses(false);
    }
  }, [selectedWarehouseId]);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  // Load warehouse stocks & history when active changes
  const fetchWarehouseDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setErrorMsg(null);
    try {
      const detail = await getWarehouseById(id);
      setWarehouseDetail(detail);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al cargar detalle de bodega');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWarehouseId) {
      fetchWarehouseDetail(selectedWarehouseId);
    }
  }, [selectedWarehouseId, fetchWarehouseDetail]);

  // Handle Autocomplete search
  useEffect(() => {
    if (searchSupplyQuery.trim().length >= 2) {
      const delay = setTimeout(async () => {
        try {
          const results = await listSupplies(searchSupplyQuery);
          setSuggestedSupplies(results);
        } catch (err) {
          console.error(err);
        }
      }, 300);
      return () => clearTimeout(delay);
    } else {
      setSuggestedSupplies([]);
    }
  }, [searchSupplyQuery]);

  // Create warehouse action
  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whCode || !whName) {
      setErrorMsg('El código y el nombre son obligatorios.');
      return;
    }
    if (whCode.length > 4) {
      setErrorMsg('El código no puede superar los 4 caracteres.');
      return;
    }
    setCreatingWh(true);
    setErrorMsg(null);
    try {
      const newWh = await createWarehouse({
        code: whCode.toUpperCase(),
        name: whName,
        location: whLocation || undefined,
      });
      setWarehouses((prev) => [...prev, newWh].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedWarehouseId(newWh.id);
      setShowCreateWarehouse(false);
      setWhCode('');
      setWhName('');
      setWhLocation('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al crear la bodega');
    } finally {
      setCreatingWh(false);
    }
  };

  // Create supply action
  const handleCreateSupply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplyCode || !supplyName) {
      setErrorMsg('El código y el nombre son obligatorios.');
      return;
    }
    setCreatingSupply(true);
    setErrorMsg(null);
    try {
      const newSupply = await createSupply({
        code: supplyCode.toUpperCase(),
        name: supplyName,
        description: supplyDesc || undefined,
        category: supplyCategory || undefined,
        unit: supplyUnit,
      });
      setSelectedSupply(newSupply);
      setSearchSupplyQuery(newSupply.name);
      setSuggestedSupplies([]);
      setShowCreateSupply(false);
      setSupplyCode('');
      setSupplyName('');
      setSupplyDesc('');
      setSupplyCategory('');
      setSupplyUnit('unidades');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al crear el insumo');
    } finally {
      setCreatingSupply(false);
    }
  };

  // Register Transaction action
  const handleRegisterTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarehouseId) {
      setErrorMsg('Por favor selecciona una bodega activa.');
      return;
    }
    if (!selectedSupply) {
      setErrorMsg('Por favor selecciona un insumo de la lista sugerida.');
      return;
    }
    if (txQuantity <= 0) {
      setErrorMsg('La cantidad debe ser mayor que cero.');
      return;
    }

    // Client-side validation: check negative stock
    if (txType === 'EXIT') {
      const currentStockItem = warehouseDetail?.stocks.find(
        (s) => s.supplyId === selectedSupply.id
      );
      const currentQty = currentStockItem?.quantity || 0;
      if (currentQty < txQuantity) {
        setErrorMsg(
          `Stock insuficiente. No se puede retirar ${txQuantity} ${selectedSupply.unit}. Stock actual: ${currentQty} ${selectedSupply.unit}.`
        );
        return;
      }
    }

    setRegisteringTx(true);
    setErrorMsg(null);
    try {
      await registerWarehouseTransaction(selectedWarehouseId, {
        supplyId: selectedSupply.id,
        type: txType,
        quantity: txQuantity,
        reason: txReason || undefined,
      });
      // Refresh details
      await fetchWarehouseDetail(selectedWarehouseId);
      // Reset form
      setSelectedSupply(null);
      setSearchSupplyQuery('');
      setTxQuantity(0);
      setTxReason('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al registrar la transacción');
    } finally {
      setRegisteringTx(false);
    }
  };

  // CSV parsing logic for ImportWizard
  const parseFile = async (file: File): Promise<{ rows: CsvRow[]; errors: { row: number; message: string }[] }> => {
    const text = await file.text();
    const rows: CsvRow[] = [];
    const errors: { row: number; message: string }[] = [];

    // Basic CSV splitting
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return { rows: [], errors: [{ row: 0, message: 'El archivo está vacío' }] };
    }

    const headerLine = lines[0];
    if (!headerLine) {
      return { rows: [], errors: [{ row: 0, message: 'No se pudo leer la cabecera' }] };
    }
    const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
    const codeIdx = headers.indexOf('código');
    const nameIdx = headers.indexOf('nombre');
    const descIdx = headers.indexOf('descripción');
    const catIdx = headers.indexOf('categoría');
    const unitIdx = headers.indexOf('unidad');
    const stockIdx = headers.indexOf('stock inicial');

    if (codeIdx === -1 || nameIdx === -1) {
      return {
        rows: [],
        errors: [
          {
            row: 0,
            message: 'El archivo debe tener las columnas "Código" y "Nombre" obligatoriamente.',
          },
        ],
      };
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // Regex to split comma-separated values, supporting double quotes
      const values = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) ?? line.split(',');
      const cleanValues = values.map((v) => v.replace(/^"|"$/g, '').trim());

      const code = cleanValues[codeIdx];
      const name = cleanValues[nameIdx];

      if (!code || !name) {
        errors.push({
          row: i + 1,
          message: 'Falta código o nombre del insumo.',
        });
        continue;
      }

      const initialStockRaw = stockIdx !== -1 ? (cleanValues[stockIdx] ?? '0') : '0';
      const initialStock = parseFloat(initialStockRaw) || 0;

      rows.push({
        code,
        name,
        description: descIdx !== -1 ? cleanValues[descIdx] : undefined,
        category: catIdx !== -1 ? cleanValues[catIdx] : undefined,
        unit: unitIdx !== -1 ? cleanValues[unitIdx] : 'unidades',
        initialStock: initialStock >= 0 ? initialStock : 0,
      });
    }

    return { rows, errors };
  };

  // Confirm CSV bulk import
  const handleConfirmImport = async (rows: CsvRow[]) => {
    if (!selectedWarehouseId) {
      throw new Error('Por favor selecciona una bodega activa para realizar la carga.');
    }
    const items = rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      category: r.category,
      unit: r.unit,
      initialStock: r.initialStock,
      warehouseId: selectedWarehouseId,
    }));

    await importSupplies({ items });
    await fetchWarehouseDetail(selectedWarehouseId);
    setImportOpen(false);
  };

  // Computed data for stocks filter
  const filteredStocks = warehouseDetail?.stocks.filter((stock) => {
    const supply = stock.supply;
    if (!supply) return false;
    const matchesSearch =
      supply.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
      supply.code.toLowerCase().includes(stockSearch.toLowerCase()) ||
      (supply.description && supply.description.toLowerCase().includes(stockSearch.toLowerCase()));

    const matchesCategory =
      stockCategoryFilter === 'ALL' || supply.category === stockCategoryFilter;

    return matchesSearch && matchesCategory;
  }) || [];

  // Extract unique categories for filter
  const categories = Array.from(
    new Set(
      (warehouseDetail?.stocks || [])
        .map((s) => s.supply?.category)
        .filter((c): c is string => typeof c === 'string' && c.length > 0)
    )
  );

  // Data for the CSS dynamic bar chart (Top 5 items in stock)
  const topStocks = [...(warehouseDetail?.stocks || [])]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  const maxStockQty = topStocks.length > 0 ? Math.max(...topStocks.map((s) => s.quantity)) : 1;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto py-2">
      {errorMsg && (
        <Alert variant="destructive" live>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold">Ha ocurrido un problema</p>
              <p className="mt-1">{errorMsg}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setErrorMsg(null)} className="h-auto p-1">
              Descartar
            </Button>
          </div>
        </Alert>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Panel: Warehouse Selection */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <Card className="border border-border/60 shadow-sm backdrop-blur bg-card/60">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Building className="size-5 text-primary" />
                  Bodegas
                </CardTitle>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={() => setShowCreateWarehouse(!showCreateWarehouse)}
                  title="Nueva Bodega"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <CardDescription>Selecciona la bodega activa para visualizar existencias.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {showCreateWarehouse && (
                <form onSubmit={handleCreateWarehouse} className="border border-border/80 rounded-lg p-3 bg-muted/30 flex flex-col gap-2 mb-2">
                  <p className="text-xs font-semibold text-primary uppercase">Nueva Bodega</p>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="whCode" className="text-[11px]">Código (máx 4 chars)</Label>
                    <Input
                      id="whCode"
                      placeholder="B01"
                      value={whCode}
                      onChange={(e) => setWhCode(e.target.value)}
                      maxLength={4}
                      className="h-8 text-xs font-mono uppercase"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="whName" className="text-[11px]">Nombre</Label>
                    <Input
                      id="whName"
                      placeholder="Bodega Central"
                      value={whName}
                      onChange={(e) => setWhName(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="whLocation" className="text-[11px]">Ubicación (opcional)</Label>
                    <Input
                      id="whLocation"
                      placeholder="Santiago Centro"
                      value={whLocation}
                      onChange={(e) => setWhLocation(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex gap-2 justify-end mt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowCreateWarehouse(false)}
                      disabled={creatingWh}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-7 text-xs bg-primary text-primary-foreground" disabled={creatingWh}>
                      {creatingWh ? 'Guardando...' : 'Crear'}
                    </Button>
                  </div>
                </form>
              )}

              {loadingWarehouses ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : warehouses.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No hay bodegas creadas. Utiliza el botón + de arriba.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto pr-1">
                  {warehouses.map((wh) => (
                    <button
                      key={wh.id}
                      onClick={() => setSelectedWarehouseId(wh.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 ${
                        selectedWarehouseId === wh.id
                          ? 'border-primary/50 bg-primary/5 shadow-sm text-foreground'
                          : 'border-border/60 hover:border-border/100 hover:bg-muted/30 text-muted-foreground'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="font-bold text-xs truncate max-w-[150px]">{wh.name}</span>
                        <Badge variant="outline" className="font-mono text-[9px] px-1.5 py-0 h-4 border-muted-foreground/30 text-muted-foreground bg-muted/10">
                          {wh.code}
                        </Badge>
                      </div>
                      {wh.location && (
                        <span className="text-[10px] flex items-center gap-1 text-muted-foreground/80">
                          <MapPin className="size-3 text-muted-foreground/60" />
                          {wh.location}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats Chart */}
          {warehouseDetail && warehouseDetail.stocks.length > 0 && (
            <Card className="border border-border/60 shadow-sm backdrop-blur bg-card/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                  <TrendingUp className="size-4 text-primary" />
                  Existencias Principales
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {topStocks.map((s, idx) => {
                  const percentage = Math.round((s.quantity / maxStockQty) * 100);
                  const hue = (140 - idx * 22) % 360; // Vibrant color gradient
                  return (
                    <div key={s.supplyId} className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="font-medium truncate max-w-[120px]">{s.supply?.name}</span>
                        <span className="font-bold text-foreground/90">
                          {s.quantity} <span className="text-muted-foreground text-[10px]">{s.supply?.unit}</span>
                        </span>
                      </div>
                      <div className="w-full bg-muted/60 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: `hsl(${hue}, 85%, 45%)`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Panel: Active Warehouse Stock & Transactions */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {selectedWarehouseId ? (
            <>
              {/* Warehouse Details and Actions */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/20 border border-border/65 rounded-xl p-4 backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Boxes className="size-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                      {warehouseDetail?.warehouse.name}
                      <Badge variant="outline" className="font-mono text-xs border-primary/30 text-primary bg-primary/5">
                        {warehouseDetail?.warehouse.code}
                      </Badge>
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Ubicación: {warehouseDetail?.warehouse.location || 'No especificada'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 text-xs">
                    <FileSpreadsheet className="size-4" />
                    Carga CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowCreateSupply(true)} className="flex items-center gap-1.5 text-xs">
                    <Plus className="size-4" />
                    Crear Insumo
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Supplies & Transactions Form */}
                <Card className="xl:col-span-1 border border-border/60 shadow-sm bg-card/70">
                  <CardHeader>
                    <CardTitle className="text-md font-bold flex items-center gap-2">
                      <ArrowRightLeft className="size-4 text-primary" />
                      Registrar Transacción
                    </CardTitle>
                    <CardDescription>
                      Ingreso (ENTRY) o Egreso (EXIT) de insumos del inventario físico.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleRegisterTransaction} className="flex flex-col gap-4">
                      {/* Autocomplete Search */}
                      <div className="flex flex-col gap-1.5 relative">
                        <Label htmlFor="searchSupply" className="text-xs">Buscar Insumo *</Label>
                        <div className="relative">
                          <Input
                            id="searchSupply"
                            placeholder="Digita código o nombre..."
                            value={searchSupplyQuery}
                            onChange={(e) => {
                              setSearchSupplyQuery(e.target.value);
                              if (selectedSupply && e.target.value !== selectedSupply.name) {
                                setSelectedSupply(null);
                              }
                            }}
                            className="text-xs pr-8"
                          />
                          <Search className="absolute right-2.5 top-2.5 size-4 text-muted-foreground/60" />
                        </div>

                        {suggestedSupplies.length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50 max-h-48 overflow-y-auto">
                            {suggestedSupplies.map((sup) => (
                              <button
                                type="button"
                                key={sup.id}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-muted/80 flex flex-col gap-0.5 border-b border-border/40 last:border-0"
                                onClick={() => {
                                  setSelectedSupply(sup);
                                  setSearchSupplyQuery(sup.name);
                                  setSuggestedSupplies([]);
                                }}
                              >
                                <div className="flex justify-between items-center w-full font-bold text-foreground">
                                  <span>{sup.name}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">{sup.code}</span>
                                </div>
                                <span className="text-[10px] text-muted-foreground/80">
                                  Cat: {sup.category || 'Sin categoría'} | Unidad: {sup.unit}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {selectedSupply && (
                          <div className="mt-1 p-2 rounded border border-primary/20 bg-primary/5 flex items-center justify-between">
                            <div className="text-[11px]">
                              <span className="font-bold text-primary">{selectedSupply.name}</span>
                              <p className="text-[10px] text-muted-foreground">Código: {selectedSupply.code}</p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setSelectedSupply(null);
                                setSearchSupplyQuery('');
                              }}
                            >
                              X
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Type: Entry/Exit */}
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Tipo de Movimiento *</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setTxType('ENTRY')}
                            className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                              txType === 'ENTRY'
                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                                : 'border-border/60 hover:bg-muted/30 text-muted-foreground'
                            }`}
                          >
                            Ingreso (ENTRY)
                          </button>
                          <button
                            type="button"
                            onClick={() => setTxType('EXIT')}
                            className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                              txType === 'EXIT'
                                ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                                : 'border-border/60 hover:bg-muted/30 text-muted-foreground'
                            }`}
                          >
                            Egreso (EXIT)
                          </button>
                        </div>
                      </div>

                      {/* Quantity */}
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="txQty" className="text-xs">Cantidad *</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="txQty"
                            type="number"
                            step="any"
                            placeholder="0.00"
                            value={txQuantity === 0 ? '' : txQuantity}
                            onChange={(e) => setTxQuantity(parseFloat(e.target.value) || 0)}
                            className="text-xs flex-1"
                          />
                          {selectedSupply && (
                            <span className="text-xs font-bold text-muted-foreground/80 px-2 bg-muted rounded py-2 border">
                              {selectedSupply.unit}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Reason */}
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="txReason" className="text-xs">Motivo / Causa (opcional)</Label>
                        <Input
                          id="txReason"
                          placeholder="Ej: Consumo en faena / Abastecimiento inicial"
                          value={txReason}
                          onChange={(e) => setTxReason(e.target.value)}
                          className="text-xs"
                        />
                      </div>

                      <Button
                        type="submit"
                        className="w-full text-xs font-semibold bg-primary text-primary-foreground mt-2"
                        disabled={registeringTx || !selectedSupply || txQuantity <= 0}
                      >
                        {registeringTx ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin mr-1.5" />
                            Registrando...
                          </>
                        ) : (
                          'Registrar Movimiento'
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {/* Stock Table & Filters */}
                <Card className="xl:col-span-2 border border-border/60 shadow-sm bg-card/70 flex flex-col">
                  <CardHeader className="pb-3 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div>
                      <CardTitle className="text-md font-bold flex items-center gap-2">
                        <Package className="size-4 text-primary" />
                        Existencias Actuales
                      </CardTitle>
                      <CardDescription>Catálogo de existencias de insumos en bodega activa.</CardDescription>
                    </div>

                    <div className="flex gap-2 w-full sm:w-auto">
                      <div className="relative flex-1 sm:w-48">
                        <Input
                          placeholder="Buscar..."
                          value={stockSearch}
                          onChange={(e) => setStockSearch(e.target.value)}
                          className="h-8 text-xs pl-8 pr-3"
                        />
                        <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/60" />
                      </div>

                      <Select
                        aria-label="Filtrar por categoría"
                        value={stockCategoryFilter}
                        onChange={(e) => setStockCategoryFilter(e.target.value)}
                        className="h-8 w-auto text-xs"
                      >
                        <option value="ALL">Categoría: Todos</option>
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-x-auto">
                    {loadingDetail ? (
                      <LoadingState label="Cargando existencias…" />
                    ) : filteredStocks.length === 0 ? (
                      <EmptyState
                        icon={Package}
                        title="Sin existencias registradas"
                        message="Registra un ingreso o carga un CSV para inicializar el stock."
                      />
                    ) : (
                      <div className="max-h-[360px] overflow-y-auto rounded-md border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Insumo</TableHead>
                              <TableHead>Código</TableHead>
                              <TableHead>Categoría</TableHead>
                              <TableHead className="text-right">Stock Actual</TableHead>
                              <TableHead className="text-right">Unidad</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredStocks.map((stock) => (
                              <TableRow key={stock.supplyId} className="hover:bg-muted/30">
                                <TableCell>
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-bold text-xs">{stock.supply?.name}</span>
                                    {stock.supply?.description && (
                                      <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                                        {stock.supply.description}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {stock.supply?.code}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary" className="text-[9px] font-medium h-5">
                                    {stock.supply?.category || 'Sin categoría'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-bold font-mono text-xs">
                                  {stock.quantity}
                                </TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">
                                  {stock.supply?.unit}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Transactions History ledger */}
              <Card className="border border-border/60 shadow-sm bg-card/70 mt-6">
                <CardHeader>
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <History className="size-4 text-primary" />
                    Historial de Movimientos Recientes
                  </CardTitle>
                  <CardDescription>
                    Registro cronológico de los últimos 50 ingresos y egresos de esta bodega.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingDetail ? (
                    <LoadingState rows={4} label="Cargando movimientos…" />
                  ) : !warehouseDetail?.transactions || warehouseDetail.transactions.length === 0 ? (
                    <EmptyState message="No hay transacciones registradas históricamente." />
                  ) : (
                    <div className="max-h-[300px] overflow-y-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Insumo</TableHead>
                            <TableHead>Movimiento</TableHead>
                            <TableHead className="text-right">Cantidad</TableHead>
                            <TableHead>Operador / Responsable</TableHead>
                            <TableHead>Motivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {warehouseDetail.transactions.map((tx) => (
                            <TableRow key={tx.id} className="hover:bg-muted/30">
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(tx.createdAt).toLocaleString('es-CL', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-xs">{tx.supply?.name}</span>
                                  <Badge variant="outline" className="font-mono text-[9px] h-4">
                                    {tx.supply?.code}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                {tx.type === 'ENTRY' ? (
                                  <Badge variant="outline" className="text-[10px] font-bold border-emerald-500/30 text-emerald-500 bg-emerald-500/5 px-2">
                                    Ingreso (ENTRY)
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] font-bold border-amber-500/30 text-amber-500 bg-amber-500/5 px-2">
                                    Egreso (EXIT)
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold text-xs">
                                {tx.type === 'ENTRY' ? '+' : '-'}{tx.quantity} <span className="text-[10px] text-muted-foreground font-normal">{tx.supply?.unit}</span>
                              </TableCell>
                              <TableCell className="text-xs font-medium text-foreground/80">
                                {tx.actor ? `${tx.actor.firstName} ${tx.actor.lastName}` : 'Sistema'}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={tx.reason || ''}>
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
          ) : (
            <div className="flex flex-col items-center justify-center py-32 border border-dashed rounded-lg border-border bg-card/40">
              <Building className="size-16 text-muted-foreground/40" />
              <h3 className="text-md font-bold text-muted-foreground/80 mt-4">No has seleccionado ninguna bodega</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm text-center">
                Selecciona una bodega en la lista lateral para ver su stock actual, registrar movimientos o cargar archivos CSV.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Creation Modal for Supplies */}
      {showCreateSupply && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="p-5 border-b border-border flex justify-between items-center">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Package className="size-5 text-primary" />
                Registrar Nuevo Insumo
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-full"
                onClick={() => setShowCreateSupply(false)}
              >
                X
              </Button>
            </div>
            <form onSubmit={handleCreateSupply} className="p-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="supplyCode">Código de Referencia *</Label>
                <Input
                  id="supplyCode"
                  placeholder="INS-MAT01"
                  value={supplyCode}
                  onChange={(e) => setSupplyCode(e.target.value)}
                  className="text-xs font-mono uppercase"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="supplyName">Nombre *</Label>
                <Input
                  id="supplyName"
                  placeholder="Cemento Portland"
                  value={supplyName}
                  onChange={(e) => setSupplyName(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="supplyDesc">Descripción (opcional)</Label>
                <Input
                  id="supplyDesc"
                  placeholder="Sacos de cemento 25kg"
                  value={supplyDesc}
                  onChange={(e) => setSupplyDesc(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="supplyCategory">Categoría</Label>
                <Input
                  id="supplyCategory"
                  placeholder="Materiales de Obra"
                  value={supplyCategory}
                  onChange={(e) => setSupplyCategory(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="supplyUnit">Unidad de Medida</Label>
                <Input
                  id="supplyUnit"
                  placeholder="sacos / kg / unidades"
                  value={supplyUnit}
                  onChange={(e) => setSupplyUnit(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex gap-2 justify-end border-t border-border pt-4 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateSupply(false)}
                  disabled={creatingSupply}
                >
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="bg-primary text-primary-foreground" disabled={creatingSupply}>
                  {creatingSupply ? 'Guardando...' : 'Guardar Insumo'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Bulk Import Wizard */}
      <ImportWizard<CsvRow>
        open={importOpen}
        onOpenChange={setImportOpen}
        title={`Importar Insumos — ${warehouseDetail?.warehouse.name}`}
        description="Descarga el formato patrón, ingresa el listado de insumos y define el stock inicial. Los insumos se vincularán a la bodega activa."
        templateFileName={`plantilla-insumos-${warehouseDetail?.warehouse.code}`}
        templateColumns={TEMPLATE_COLUMNS}
        parseFile={parseFile}
        previewColumns={[
          {
            header: 'Código',
            render: (r) => <span className="font-mono text-xs font-semibold">{r.code}</span>,
          },
          {
            header: 'Nombre',
            render: (r) => <span className="font-semibold text-xs">{r.name}</span>,
          },
          {
            header: 'Categoría',
            render: (r) => <Badge variant="secondary" className="text-[10px]">{r.category || 'Sin categoría'}</Badge>,
          },
          {
            header: 'Stock Inicial',
            render: (r) => <span className="font-mono font-bold text-xs">{r.initialStock || 0} {r.unit || 'unidades'}</span>,
          },
        ]}
        onConfirm={handleConfirmImport}
      />
    </div>
  );
}
