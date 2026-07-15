import type { ReactNode } from 'react';
import type { InventoryImportItemInput, InventoryImportResult } from '@gmt-platform/contracts';
import { Badge } from '@/components/ui/badge';
import { ImportWizard, type ImportTemplateColumn } from '@/components/primitives/import-wizard';
import { importInventoryItems } from '@/lib/api';

/**
 * Columnas de la plantilla CSV del import de artículos. `bodegaN` es el CÓDIGO
 * de la bodega (no el nombre) y `cantidadN` su stock inicial: hasta 4 pares.
 */
const TEMPLATE_COLUMNS: ImportTemplateColumn[] = [
  { key: 'codigo', label: 'Código', example: 'INS-001' },
  { key: 'nombre', label: 'Nombre', example: 'Casco de seguridad' },
  { key: 'marca', label: 'Marca', example: '3M' },
  { key: 'tipo', label: 'Tipo', example: 'EPP' },
  { key: 'color', label: 'Color', example: 'Blanco' },
  { key: 'talla', label: 'Talla', example: 'L' },
  { key: 'modelo', label: 'Modelo', example: 'H-700' },
  { key: 'unidad', label: 'Unidad de medida', example: 'unidades' },
  { key: 'descripcion', label: 'Descripción', example: 'Casco con arnés de 4 puntas' },
  { key: 'bodega1', label: 'Bodega 1 (código)', example: 'B01' },
  { key: 'cantidad1', label: 'Cantidad 1', example: '10' },
  { key: 'bodega2', label: 'Bodega 2 (código)', example: '' },
  { key: 'cantidad2', label: 'Cantidad 2', example: '' },
  { key: 'bodega3', label: 'Bodega 3 (código)', example: '' },
  { key: 'cantidad3', label: 'Cantidad 3', example: '' },
  { key: 'bodega4', label: 'Bodega 4 (código)', example: '' },
  { key: 'cantidad4', label: 'Cantidad 4', example: '' },
];

/** Parser CSV robusto con soporte de campos entre comillas (",", comillas escapadas y saltos). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  // Última celda/fila si el archivo no termina en salto de línea.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Diálogo de import masivo de artículos de inventario. Ensambla la primitiva
 * `ImportWizard` (§5): descarga de plantilla → subir CSV → preview → confirmar.
 * Validación por fila en el cliente (código y nombre obligatorios, cantidades
 * numéricas >= 0, cantidad con bodega); el backend además valida y reporta
 * errores por fila (bodega inexistente, etc.) sin abortar el lote.
 */
export function ImportItemsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (result: InventoryImportResult) => void;
}): ReactNode {
  async function parseFile(
    file: File,
  ): Promise<{ rows: InventoryImportItemInput[]; errors: { row: number; message: string }[] }> {
    const text = await file.text();
    const matrix = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
    if (matrix.length === 0) {
      return { rows: [], errors: [{ row: 0, message: 'El archivo está vacío.' }] };
    }

    const header = (matrix[0] ?? []).map((h) => h.trim().toLowerCase());
    const idx = (key: string): number => header.indexOf(key);
    const missing = ['codigo', 'nombre'].filter((k) => idx(k) === -1);
    if (missing.length > 0) {
      return {
        rows: [],
        errors: [{ row: 0, message: `Faltan columnas en la cabecera: ${missing.join(', ')}.` }],
      };
    }

    const rows: InventoryImportItemInput[] = [];
    const errors: { row: number; message: string }[] = [];
    const cell = (r: string[], key: string): string => {
      const i = idx(key);
      return i === -1 ? '' : (r[i] ?? '').trim();
    };

    for (let i = 1; i < matrix.length; i += 1) {
      const raw = matrix[i] ?? [];
      const rowNo = i + 1; // 1-indexado, contando la cabecera
      const codigo = cell(raw, 'codigo');
      const nombre = cell(raw, 'nombre');

      const problems: string[] = [];
      if (codigo.length === 0) problems.push('falta el código');
      if (nombre.length === 0) problems.push('falta el nombre');

      // Stock inicial: hasta 4 pares bodegaN/cantidadN (bodega POR CÓDIGO).
      const stocks: Array<{ warehouseCode: string; quantity: number }> = [];
      for (let n = 1; n <= 4; n += 1) {
        const bodega = cell(raw, `bodega${n}`);
        const cantidadRaw = cell(raw, `cantidad${n}`);
        if (bodega.length === 0 && cantidadRaw.length === 0) continue;

        let cantidad = 0;
        if (cantidadRaw.length > 0) {
          const parsed = Number(cantidadRaw);
          if (!Number.isFinite(parsed) || parsed < 0) {
            problems.push(`cantidad${n} debe ser un número mayor o igual a cero`);
            continue;
          }
          cantidad = parsed;
        }
        if (cantidad > 0 && bodega.length === 0) {
          problems.push(`cantidad${n} requiere el código de bodega${n}`);
          continue;
        }
        if (bodega.length > 0 && cantidad > 0) {
          stocks.push({ warehouseCode: bodega.toUpperCase(), quantity: cantidad });
        }
      }

      if (problems.length > 0) {
        errors.push({ row: rowNo, message: problems.join('; ') });
        continue;
      }

      const marca = cell(raw, 'marca');
      const tipo = cell(raw, 'tipo');
      const color = cell(raw, 'color');
      const talla = cell(raw, 'talla');
      const modelo = cell(raw, 'modelo');
      const unidad = cell(raw, 'unidad');
      const descripcion = cell(raw, 'descripcion');

      rows.push({
        code: codigo.toUpperCase(),
        name: nombre,
        brand: marca.length > 0 ? marca : undefined,
        category: tipo.length > 0 ? tipo : undefined,
        color: color.length > 0 ? color : undefined,
        size: talla.length > 0 ? talla : undefined,
        model: modelo.length > 0 ? modelo : undefined,
        unit: unidad.length > 0 ? unidad : undefined,
        description: descripcion.length > 0 ? descripcion : undefined,
        stocks: stocks.length > 0 ? stocks : undefined,
      });
    }

    return { rows, errors };
  }

  async function handleConfirm(rows: InventoryImportItemInput[]): Promise<void> {
    const result = await importInventoryItems(rows);
    onImported(result);
    onOpenChange(false);
  }

  return (
    <ImportWizard<InventoryImportItemInput>
      open={open}
      onOpenChange={onOpenChange}
      title="Importar artículos"
      description="Carga un CSV con la plantilla para crear o actualizar artículos, con stock inicial opcional en hasta 4 bodegas (por código de bodega)."
      templateFileName="plantilla-articulos-inventario"
      templateColumns={TEMPLATE_COLUMNS}
      parseFile={parseFile}
      previewColumns={[
        {
          header: 'Código',
          render: (r) => <span className="font-mono text-xs font-semibold">{r.code}</span>,
        },
        {
          header: 'Nombre',
          render: (r) => <span className="text-xs font-semibold">{r.name}</span>,
        },
        {
          header: 'Tipo',
          render: (r) => (
            <Badge variant="secondary" className="text-[10px]">
              {r.category ?? 'Sin tipo'}
            </Badge>
          ),
        },
        {
          header: 'Stock inicial',
          render: (r) =>
            r.stocks && r.stocks.length > 0 ? (
              <span className="font-mono text-xs">
                {r.stocks.map((s) => `${s.warehouseCode}: ${s.quantity}`).join(' · ')}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Sin stock</span>
            ),
        },
      ]}
      onConfirm={handleConfirm}
    />
  );
}
