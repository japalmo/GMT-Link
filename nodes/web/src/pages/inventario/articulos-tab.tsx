import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Package, Plus } from 'lucide-react';
import type { InventoryImportResult, InventoryItemView, TableRequest } from '@gmt-platform/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { DataTable, type DataTableColumn, type DataTableFilter } from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import {
  createInventoryItem,
  errorToMessage,
  fetchInventoryCatalog,
  fetchInventoryItemsTable,
  type CreateInventoryItemInput,
} from '@/lib/api';
import { ArticuloDetail } from './articulo-detail';
import { ImportItemsDialog } from './import-items-dialog';

/**
 * Pestaña Artículos del módulo Inventario: catálogo con el MOTOR de tablas
 * (búsqueda server-side por código/nombre/marca/modelo, filtro por tipo),
 * alta individual, import masivo por CSV y detalle inline (master-detail).
 */
export function ArticulosTab(): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return <ArticuloDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <ArticulosCatalog onSelect={setSelectedId} />;
}

function ArticulosCatalog({ onSelect }: { onSelect: (id: string) => void }): ReactNode {
  const fetcher = useCallback((req: TableRequest) => fetchInventoryItemsTable(req), []);
  const table = useDataTable<InventoryItemView>(fetcher, {
    initialSortBy: 'nombre',
    initialSortDir: 'asc',
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<InventoryImportResult | null>(null);

  // Opciones del filtro por tipo (category): se derivan del catálogo liviano.
  // Es solo presentación; el filtrado real ocurre server-side.
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchInventoryCatalog()
      .then((items) => {
        if (cancelled) return;
        const unique = Array.from(
          new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c && c.trim()))),
        ).sort((a, b) => a.localeCompare(b, 'es'));
        setCategories(unique);
      })
      .catch(() => {
        // Sin opciones de filtro: la tabla sigue funcionando (búsqueda y orden).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryFilter: DataTableFilter = {
    id: 'category',
    label: 'Tipo',
    allLabel: 'Todos los tipos',
    options: categories.map((c) => ({ value: c, label: c })),
  };

  const columns: ReadonlyArray<DataTableColumn<InventoryItemView>> = [
    {
      id: 'codigo',
      header: 'Código',
      sortable: true,
      render: (item) => <span className="font-mono text-xs">{item.code}</span>,
    },
    {
      id: 'nombre',
      header: 'Nombre',
      sortable: true,
      render: (item) => (
        <div className="flex flex-col">
          <span className="font-medium">{item.name}</span>
          {item.description && (
            <span className="text-xs text-muted-foreground line-clamp-1">{item.description}</span>
          )}
        </div>
      ),
    },
    {
      id: 'marca',
      header: 'Marca',
      render: (item) => item.brand || <span className="text-muted-foreground">Sin marca</span>,
    },
    {
      id: 'categoria',
      header: 'Tipo',
      sortable: true,
      render: (item) =>
        item.category ? (
          <Badge variant="secondary">{item.category}</Badge>
        ) : (
          <span className="text-muted-foreground">Sin tipo</span>
        ),
    },
    {
      id: 'stock',
      header: 'Stock total',
      className: 'text-right',
      render: (item) =>
        item.totalStock === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <span className="font-mono font-semibold">{item.totalStock}</span>
        ),
    },
    {
      id: 'proveedores',
      header: 'Proveedores',
      className: 'text-right',
      render: (item) =>
        item.providerCount === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <span className="font-mono">{item.providerCount}</span>
        ),
    },
  ];

  function handleImported(result: InventoryImportResult): void {
    setImportResult(result);
    table.refetch();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Package className="size-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Catálogo de artículos</h2>
            <p className="text-xs text-muted-foreground">
              Artículos de inventario con su stock total por bodega y proveedores vinculados.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet aria-hidden />
            Importar CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            Nuevo artículo
          </Button>
        </div>
      </div>

      {importResult && (
        <Alert variant={importResult.errors.length > 0 ? 'warning' : 'info'} live>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold">
                Importación completada: {importResult.created}{' '}
                {importResult.created === 1 ? 'artículo creado' : 'artículos creados'},{' '}
                {importResult.updated}{' '}
                {importResult.updated === 1 ? 'actualizado' : 'actualizados'}.
              </p>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto text-xs">
                  {importResult.errors.map((err, i) => (
                    <li key={`${err.code}-${i}`}>
                      <span className="font-mono">{err.code}</span>: {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-1"
              onClick={() => setImportResult(null)}
            >
              Descartar
            </Button>
          </div>
        </Alert>
      )}

      <DataTable<InventoryItemView>
        table={table}
        columns={columns}
        getRowId={(item) => item.id}
        searchable
        searchPlaceholder="Buscar por código, nombre, marca o modelo…"
        filters={[categoryFilter]}
        onRowClick={(item) => onSelect(item.id)}
        rowActions={(item) => (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onSelect(item.id)}>
            Detalle
          </Button>
        )}
        emptyMessage="No hay artículos que coincidan. Crea el primero o ajusta los filtros."
        caption="Catálogo de artículos de inventario"
      />

      <CreateItemDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => table.refetch()}
      />

      <ImportItemsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={handleImported}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------
   Diálogo "Nuevo artículo" (campos descriptivos; el stock se carga por import
   o por movimientos de bodega). 409 de código duplicado se muestra inline.
   -------------------------------------------------------------------------- */

interface ItemFormState {
  code: string;
  name: string;
  brand: string;
  category: string;
  color: string;
  size: string;
  model: string;
  unit: string;
  description: string;
}

const EMPTY_ITEM_FORM: ItemFormState = {
  code: '',
  name: '',
  brand: '',
  category: '',
  color: '',
  size: '',
  model: '',
  unit: '',
  description: '',
};

function CreateItemDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): ReactNode {
  const baseId = useId();
  const [form, setForm] = useState<ItemFormState>(EMPTY_ITEM_FORM);
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-siembra síncrona al abrir, sin frame con datos de la apertura anterior.
  if (open && !seeded) {
    setForm(EMPTY_ITEM_FORM);
    setError(null);
    setSeeded(true);
  }
  if (!open && seeded) {
    setSeeded(false);
  }

  function update<K extends keyof ItemFormState>(key: K, value: ItemFormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (form.code.trim().length === 0 || form.name.trim().length === 0) {
      setError('El código y el nombre son obligatorios.');
      return;
    }
    setError(null);
    setSaving(true);
    const input: CreateInventoryItemInput = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      category: form.category.trim() || undefined,
      color: form.color.trim() || undefined,
      size: form.size.trim() || undefined,
      model: form.model.trim() || undefined,
      unit: form.unit.trim() || undefined,
      description: form.description.trim() || undefined,
    };
    try {
      await createInventoryItem(input);
      toast.success('Artículo creado con éxito.');
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo crear el artículo.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // No permitir cerrar (Cancelar / X / ESC / overlay) mientras se guarda.
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <ModalContent className="sm:max-w-2xl">
        <ModalHeader>
          <ModalTitle>Nuevo artículo</ModalTitle>
          <ModalDescription>
            Crea la ficha descriptiva del artículo. El stock se carga por import CSV o desde las
            bodegas.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-code`}>Código</Label>
              <Input
                id={`${baseId}-code`}
                value={form.code}
                onChange={(e) => update('code', e.target.value.toUpperCase())}
                placeholder="INS-001"
                className="font-mono"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${baseId}-name`}>Nombre</Label>
              <Input
                id={`${baseId}-name`}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Ej. Casco de seguridad"
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
                placeholder="Ej. 3M"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-category`}>Tipo</Label>
              <Input
                id={`${baseId}-category`}
                value={form.category}
                onChange={(e) => update('category', e.target.value)}
                placeholder="Ej. EPP"
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
                placeholder="Ej. Blanco"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-size`}>Talla</Label>
              <Input
                id={`${baseId}-size`}
                value={form.size}
                onChange={(e) => update('size', e.target.value)}
                placeholder="Ej. L"
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
                placeholder="Ej. H-700"
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
              rows={2}
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

          <ModalFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Crear artículo
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
