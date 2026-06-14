import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ImportWizard,
  type ImportPreviewColumn,
  type ImportTemplateColumn,
  type ParseResult,
} from '@/components/primitives/import-wizard';

/** Fila de reembolso para la demo. */
interface ReembolsoRow {
  monto: number;
  fecha: string;
  glosa: string;
}

const TEMPLATE_COLUMNS: ImportTemplateColumn[] = [
  { key: 'monto', label: 'Monto (CLP)', example: '15000' },
  { key: 'fecha', label: 'Fecha', example: '2026-06-13' },
  { key: 'glosa', label: 'Glosa', example: 'Taxi a faena' },
];

const PREVIEW_COLUMNS: ImportPreviewColumn<ReembolsoRow>[] = [
  {
    header: 'Monto',
    className: 'text-right tabular-nums',
    render: (r) => `$${r.monto.toLocaleString('es-CL')}`,
  },
  { header: 'Fecha', render: (r) => r.fecha },
  { header: 'Glosa', render: (r) => r.glosa },
];

/**
 * CSV de ejemplo precargado para la demo. Incluye:
 * - 2 filas válidas
 * - 1 fila con monto no numérico (error)
 * - 1 fila con columnas faltantes (error)
 */
const SAMPLE_CSV = [
  'monto,fecha,glosa',
  '15000,2026-06-01,Taxi a faena',
  '8200,2026-06-03,Almuerzo terreno',
  'abc,2026-06-05,Estacionamiento', // monto inválido
  '5000,2026-06-07', // falta la glosa
].join('\n');

/** Parser CSV simple para la demo: split por líneas/comas + validación. */
async function parseReembolsosCsv(file: File): Promise<ParseResult<ReembolsoRow>> {
  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: ReembolsoRow[] = [];
  const errors: { row: number; message: string }[] = [];

  // La primera línea es la cabecera; los datos empiezan en la línea 2.
  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    errors.push({ row: 1, message: 'El archivo no contiene filas de datos.' });
    return { rows, errors };
  }

  dataLines.forEach((line, index) => {
    const rowNumber = index + 1; // 1-indexado respecto a los datos
    const cells = line.split(',').map((c) => c.trim());

    if (cells.length < 3) {
      errors.push({
        row: rowNumber,
        message: `Se esperaban 3 columnas (monto, fecha, glosa) y llegaron ${cells.length}.`,
      });
      return;
    }

    const [montoRaw, fecha, ...glosaParts] = cells;
    const glosa = glosaParts.join(',').trim();
    const monto = Number(montoRaw);

    if (montoRaw === undefined || montoRaw === '' || Number.isNaN(monto)) {
      errors.push({
        row: rowNumber,
        message: `El monto "${montoRaw ?? ''}" no es un número válido.`,
      });
      return;
    }
    if (!fecha) {
      errors.push({ row: rowNumber, message: 'Falta la fecha.' });
      return;
    }
    if (!glosa) {
      errors.push({ row: rowNumber, message: 'Falta la glosa.' });
      return;
    }

    rows.push({ monto, fecha, glosa });
  });

  return { rows, errors };
}

/** Simula el guardado en backend con un pequeño retardo. */
function fakeSave(rows: ReembolsoRow[]): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      console.log('Reembolsos importados:', rows);
      resolve();
    }, 1200);
  });
}

export default function ImportWizardDemo() {
  const [open, setOpen] = useState(false);

  function downloadSample(): void {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'reembolsos-ejemplo.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">Primitivas · §5</p>
        <h1 className="text-3xl font-bold tracking-tight">ImportWizard</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Overlay de 4 pasos: descargar formato → subir → preview → confirmar.
          Demo con plantilla de reembolsos y un parser CSV real.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Importar reembolsos</CardTitle>
          <CardDescription>
            Abre el asistente y carga un CSV. Puedes descargar un archivo de
            ejemplo (incluye dos filas con errores para ver el manejo de
            validación).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => setOpen(true)}>
            <Upload aria-hidden />
            Importar
          </Button>
          <Button variant="outline" onClick={downloadSample}>
            Descargar CSV de ejemplo
          </Button>
        </CardContent>
      </Card>

      <ImportWizard<ReembolsoRow>
        open={open}
        onOpenChange={setOpen}
        title="Importar reembolsos"
        description="Carga tus reembolsos desde un archivo CSV."
        templateFileName="plantilla-reembolsos"
        templateColumns={TEMPLATE_COLUMNS}
        previewColumns={PREVIEW_COLUMNS}
        parseFile={parseReembolsosCsv}
        onConfirm={fakeSave}
        aiHelpSlot={
          <p className="text-xs text-muted-foreground">
            Próximamente: limpieza asistida por IA para ordenar columnas
            automáticamente (cuota 3/día).
          </p>
        }
      />
    </div>
  );
}
