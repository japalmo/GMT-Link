# ImportWizard (Primitiva §5)

Overlay genérico de **4 pasos** para importar datos tabulares. Construido sobre
la `<Modal/>` (Radix) del design system: en móvil es una hoja inferior, en
escritorio una tarjeta centrada. Es **agnóstica del dominio** y **type-safe**:
se parametriza por el tipo de fila `TRow` y no usa `any`.

> El consumidor define la plantilla, **parsea/valida** el archivo y **confirma**.
> La primitiva orquesta los pasos, la navegación, la validación de avance y los
> estados de vacío / carga / error.

## Flujo de 4 pasos

1. **Descargar formato** — muestra las columnas esperadas (etiqueta + clave +
   ejemplo) y ofrece descargar la plantilla `.csv` (vía `Blob` + enlace). Si no
   se provee `getTemplate`, el CSV se genera desde `templateColumns`
   (cabeceras + fila de ejemplo). Aquí también vive el slot opcional de ayuda IA.
2. **Subir archivo** — `input[type=file]` accesible con `<label>` asociada, más
   drag & drop opcional. Al elegir archivo se invoca `parseFile`; se muestran
   estados de carga, error de lectura y un resumen de filas válidas / con error.
   No se puede avanzar sin un archivo parseado correctamente.
3. **Previsualizar** — tabla (reusa `<Table/>`) con las filas válidas usando
   `previewColumns`. Lista los errores de parseo por fila. Si hay 0 filas
   válidas, muestra estado vacío y bloquea el avance.
4. **Confirmar** — resumen + botón de importar. Llama a `onConfirm(rows)` (solo
   filas válidas) mostrando loading; al terminar muestra éxito o error con
   opción de reintentar. El confirmar está deshabilitado si hay 0 filas válidas.

El stepper es accesible: `<ol>` con `aria-current="step"`, estados
completado / actual / pendiente y etiquetas para lectores de pantalla. Durante
el guardado el overlay no se cierra por ESC ni clic afuera para no perder el
progreso.

## Props

| Prop               | Tipo                                                       | Req. | Descripción                                                        |
| ------------------ | ---------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| `open`             | `boolean`                                                  | sí   | Estado controlado de apertura.                                     |
| `onOpenChange`     | `(open: boolean) => void`                                  | sí   | Cambios de apertura (overlay, ESC, botones).                       |
| `templateColumns`  | `ImportTemplateColumn[]`                                   | sí   | `{ key; label; example? }` — define la plantilla.                  |
| `parseFile`        | `(file: File) => Promise<ParseResult<TRow>>`              | sí   | Parsea/valida; devuelve `{ rows, errors }`.                        |
| `previewColumns`   | `ImportPreviewColumn<TRow>[]`                             | sí   | `{ header; render(row); className? }` para la tabla de preview.    |
| `onConfirm`        | `(rows: TRow[]) => Promise<void>`                          | sí   | Paso 4; recibe solo filas válidas.                                 |
| `title`            | `string`                                                   | no   | Título del overlay (def. "Importar datos").                       |
| `description`      | `string`                                                   | no   | Descripción bajo el título.                                        |
| `templateFileName` | `string`                                                   | no   | Nombre del `.csv` descargado (def. "plantilla").                   |
| `getTemplate`      | `() => string`                                             | no   | CSV personalizado; si falta se genera desde `templateColumns`.     |
| `aiHelpSlot`       | `React.ReactNode`                                          | no   | Slot "¿Necesitas ayuda para ordenar los datos?" (paso 1).          |
| `maxPreviewRows`   | `number`                                                   | no   | Tope de filas mostradas en el preview (def. 50).                   |

### Tipos exportados

```ts
interface ImportTemplateColumn { key: string; label: string; example?: string }
interface ImportRowError { row: number; message: string }
interface ParseResult<TRow> { rows: TRow[]; errors: ImportRowError[] }
interface ImportPreviewColumn<TRow> {
  header: string;
  render: (row: TRow) => React.ReactNode;
  className?: string;
}
```

## Uso

```tsx
import { ImportWizard } from '@/components/primitives/import-wizard';

<ImportWizard<ReembolsoRow>
  open={open}
  onOpenChange={setOpen}
  templateColumns={[
    { key: 'monto', label: 'Monto', example: '15000' },
    { key: 'fecha', label: 'Fecha', example: '2026-06-13' },
    { key: 'glosa', label: 'Glosa', example: 'Taxi a faena' },
  ]}
  parseFile={async (file) => {
    /* split CSV, validar, devolver { rows, errors } */
  }}
  previewColumns={[
    { header: 'Monto', render: (r) => `$${r.monto.toLocaleString('es-CL')}` },
    { header: 'Fecha', render: (r) => r.fecha },
    { header: 'Glosa', render: (r) => r.glosa },
  ]}
  onConfirm={async (rows) => {
    /* POST al backend */
  }}
/>;
```

## Módulos donde se usa (§5)

- **Reembolsos** (3.2)
- **Horas extra** (3.3)
- **Insumos** (5.4)
- **Proveedores** (5.5)

El slot `aiHelpSlot` está pensado para enchufar la primitiva
`AIAssistedDataCleaner` (§5, cuota IA 3/día); su integración real queda fuera
del alcance de `ImportWizard` — aquí solo se renderiza el contenido provisto.

## Demo aislada

`nodes/web/src/pages/primitives/import-wizard-demo.tsx` (default export): un botón
"Importar" que abre el wizard con plantilla de reembolsos y un `parseFile` real
de CSV (validando que el monto sea numérico, con una fila inválida de ejemplo
para mostrar el manejo de errores).
