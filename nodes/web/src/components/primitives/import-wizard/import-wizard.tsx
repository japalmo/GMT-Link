import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  PartyPopper,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalContent,
  ModalDescription,
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
import { cn } from '@/lib/utils';

/** Definición de una columna de la plantilla de importación (paso 1). */
export interface ImportTemplateColumn {
  /** Clave estable de la columna (cabecera del CSV). */
  key: string;
  /** Etiqueta legible mostrada al usuario. */
  label: string;
  /** Valor de ejemplo opcional para la fila guía del CSV de plantilla. */
  example?: string;
}

/** Error de parseo asociado a una fila concreta del archivo subido. */
export interface ImportRowError {
  /** Número de fila (1-indexado, normalmente sin contar la cabecera). */
  row: number;
  /** Mensaje legible que explica el problema. */
  message: string;
}

/** Resultado de parsear el archivo: filas válidas + errores por fila. */
export interface ParseResult<TRow> {
  rows: TRow[];
  errors: ImportRowError[];
}

/** Columna de la tabla de preview (paso 3), parametrizada por el tipo de fila. */
export interface ImportPreviewColumn<TRow> {
  /** Encabezado de la columna en la tabla de preview. */
  header: string;
  /** Render de la celda para una fila dada. */
  render: (row: TRow) => React.ReactNode;
  /** Clases extra opcionales para la celda (alineación, ancho, etc.). */
  className?: string;
}

export interface ImportWizardProps<TRow> {
  /** Estado controlado de apertura del overlay. */
  open: boolean;
  /** Notifica cambios de apertura (cierre por overlay, ESC o botón). */
  onOpenChange: (open: boolean) => void;
  /** Título del overlay. Por defecto "Importar datos". */
  title?: string;
  /** Descripción corta bajo el título. */
  description?: string;
  /** Nombre del archivo de plantilla a descargar (sin extensión). */
  templateFileName?: string;
  /** Define la plantilla: cabeceras, etiquetas y ejemplos. */
  templateColumns: ImportTemplateColumn[];
  /**
   * Genera el contenido CSV de la plantilla. Si se omite, se construye
   * automáticamente desde `templateColumns` (cabeceras + fila de ejemplo).
   */
  getTemplate?: () => string;
  /**
   * El consumidor parsea y valida el archivo. La primitiva solo orquesta los
   * pasos y muestra filas válidas y errores.
   */
  parseFile: (file: File) => Promise<ParseResult<TRow>>;
  /** Columnas de la tabla de preview (paso 3). */
  previewColumns: ImportPreviewColumn<TRow>[];
  /** Confirma la importación (paso 4). Recibe solo las filas válidas. */
  onConfirm: (rows: TRow[]) => Promise<void>;
  /**
   * Slot opcional de ayuda IA. La integración real (AIAssistedDataCleaner, §5)
   * queda fuera de alcance; aquí solo se renderiza el contenido provisto.
   */
  aiHelpSlot?: React.ReactNode;
  /** Tope de filas a mostrar en el preview antes de resumir el resto. */
  maxPreviewRows?: number;
}

type WizardStep = 0 | 1 | 2 | 3;

const STEPS: ReadonlyArray<{ label: string; short: string }> = [
  { label: 'Descargar formato', short: 'Formato' },
  { label: 'Subir archivo', short: 'Subir' },
  { label: 'Previsualizar', short: 'Preview' },
  { label: 'Confirmar', short: 'Confirmar' },
];

type ConfirmState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'done' }
  | { status: 'error'; message: string };

/** Escapa un valor para CSV (comillas dobles y separadores). */
function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Construye un CSV de plantilla desde las columnas (cabecera + ejemplo). */
function buildTemplateCsv(columns: ImportTemplateColumn[]): string {
  const header = columns.map((c) => csvEscape(c.key)).join(',');
  const hasExamples = columns.some((c) => c.example !== undefined);
  if (!hasExamples) return `${header}\n`;
  const example = columns.map((c) => csvEscape(c.example ?? '')).join(',');
  return `${header}\n${example}\n`;
}

function StepIndicator({
  current,
  labelledBy,
}: {
  current: WizardStep;
  labelledBy: string;
}) {
  return (
    <ol
      aria-label="Progreso de importación"
      aria-describedby={labelledBy}
      className="flex items-center gap-2"
    >
      {STEPS.map((step, index) => {
        const isDone = index < current;
        const isCurrent = index === current;
        return (
          <li
            key={step.label}
            className="flex flex-1 items-center gap-2"
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                isDone && 'border-primary bg-primary text-primary-foreground',
                isCurrent && 'border-primary bg-primary/10 text-primary',
                !isDone && !isCurrent && 'border-border bg-muted text-muted-foreground',
              )}
            >
              {isDone ? <Check className="size-3.5" aria-hidden /> : index + 1}
              <span className="sr-only">
                {step.label}
                {isDone ? ' (completado)' : isCurrent ? ' (actual)' : ''}
              </span>
            </span>
            <span
              className={cn(
                'hidden truncate text-xs font-medium sm:inline',
                isCurrent ? 'text-foreground' : 'text-muted-foreground',
              )}
              aria-hidden
            >
              {step.short}
            </span>
            {index < STEPS.length - 1 && (
              <span
                className={cn(
                  'h-px flex-1 transition-colors',
                  isDone ? 'bg-primary' : 'bg-border',
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * `ImportWizard` — primitiva genérica (§5). Overlay de 4 pasos para importar
 * datos: descargar formato → subir archivo → previsualizar → confirmar.
 *
 * Es agnóstica del dominio: el consumidor define las columnas, parsea/valida el
 * archivo y confirma. Tipada por `TRow`, sin `any`. Se usa en Reembolsos,
 * Horas extra, Insumos y Proveedores.
 */
export function ImportWizard<TRow>({
  open,
  onOpenChange,
  title = 'Importar datos',
  description = 'Sigue los cuatro pasos para cargar tu archivo.',
  templateFileName = 'plantilla',
  templateColumns,
  getTemplate,
  parseFile,
  previewColumns,
  onConfirm,
  aiHelpSlot,
  maxPreviewRows = 50,
}: ImportWizardProps<TRow>) {
  const [step, setStep] = useState<WizardStep>(0);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult<TRow> | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>({ status: 'idle' });
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const fileInputId = useId();

  const resetState = useCallback(() => {
    setStep(0);
    setFile(null);
    setParsing(false);
    setParseError(null);
    setResult(null);
    setConfirmState({ status: 'idle' });
    setDragActive(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Al cerrar el overlay, limpiar el estado para una próxima apertura limpia.
  useEffect(() => {
    if (!open) {
      // Pequeño retardo para no parpadear durante la animación de cierre.
      const id = window.setTimeout(resetState, 200);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open, resetState]);

  const validRowCount = result?.rows.length ?? 0;
  const errorCount = result?.errors.length ?? 0;

  const handleDownloadTemplate = useCallback(() => {
    const csv = getTemplate ? getTemplate() : buildTemplateCsv(templateColumns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${templateFileName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [getTemplate, templateColumns, templateFileName]);

  const runParse = useCallback(
    async (selected: File) => {
      setParsing(true);
      setParseError(null);
      setResult(null);
      try {
        const parsed = await parseFile(selected);
        setResult(parsed);
      } catch (error) {
        setParseError(
          error instanceof Error
            ? error.message
            : 'No se pudo leer el archivo. Revisa el formato e inténtalo de nuevo.',
        );
      } finally {
        setParsing(false);
      }
    },
    [parseFile],
  );

  const handleFileSelected = useCallback(
    (selected: File | null) => {
      setFile(selected);
      setResult(null);
      setParseError(null);
      if (selected) void runParse(selected);
    },
    [runParse],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0] ?? null;
      handleFileSelected(selected);
    },
    [handleFileSelected],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragActive(false);
      const dropped = event.dataTransfer.files?.[0] ?? null;
      if (dropped) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        handleFileSelected(dropped);
      }
    },
    [handleFileSelected],
  );

  const canGoNext = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return file !== null && !parsing && result !== null;
    if (step === 2) return validRowCount > 0;
    return false;
  }, [step, file, parsing, result, validRowCount]);

  const goNext = useCallback(() => {
    setStep((s) => (s < 3 ? ((s + 1) as WizardStep) : s));
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => (s > 0 ? ((s - 1) as WizardStep) : s));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!result || result.rows.length === 0) return;
    setConfirmState({ status: 'saving' });
    try {
      await onConfirm(result.rows);
      setConfirmState({ status: 'done' });
    } catch (error) {
      setConfirmState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'No se pudo completar la importación. Inténtalo de nuevo.',
      });
    }
  }, [onConfirm, result]);

  const previewRows = useMemo(
    () => (result ? result.rows.slice(0, maxPreviewRows) : []),
    [result, maxPreviewRows],
  );
  const hiddenRowCount = Math.max(0, validRowCount - previewRows.length);

  const isSaving = confirmState.status === 'saving';
  const isDone = confirmState.status === 'done';

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // No permitir cerrar mientras se guarda, para no perder el progreso.
        if (isSaving) return;
        onOpenChange(next);
      }}
    >
      <ModalContent
        className="gap-5 sm:max-w-2xl"
        aria-describedby={descriptionId}
        onInteractOutside={(event) => {
          if (isSaving) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault();
        }}
      >
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription id={descriptionId}>{description}</ModalDescription>
        </ModalHeader>

        <StepIndicator current={step} labelledBy={descriptionId} />

        <div className="min-h-[16rem]">
          {/* PASO 1 — Descargar formato */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Descarga la plantilla, complétala con tus datos y vuelve para
                subirla. Respeta las cabeceras tal como aparecen.
              </p>
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Columna</TableHead>
                      <TableHead>Ejemplo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templateColumns.map((col) => (
                      <TableRow key={col.key}>
                        <TableCell className="font-medium">
                          {col.label}
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {col.key}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {col.example ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <Button variant="outline" onClick={handleDownloadTemplate}>
                  <Download aria-hidden />
                  Descargar plantilla CSV
                </Button>
              </div>
              {aiHelpSlot && (
                <div className="rounded-md border border-dashed border-border bg-muted/40 p-3">
                  <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" aria-hidden />
                    ¿Necesitas ayuda para ordenar los datos?
                  </p>
                  {aiHelpSlot}
                </div>
              )}
            </div>
          )}

          {/* PASO 2 — Subir archivo */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <label
                htmlFor={fileInputId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                  'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40',
                  dragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50',
                )}
              >
                <Upload className="size-8 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">
                  Arrastra tu archivo CSV aquí o haz clic para seleccionarlo
                </span>
                <span className="text-xs text-muted-foreground">
                  Formato esperado: el de la plantilla del paso anterior.
                </span>
                <input
                  ref={fileInputRef}
                  id={fileInputId}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={handleInputChange}
                />
              </label>

              {file && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <FileSpreadsheet
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate font-medium">{file.name}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleFileSelected(null)}
                    aria-label="Quitar archivo seleccionado"
                  >
                    <X aria-hidden />
                    Quitar
                  </Button>
                </div>
              )}

              {parsing && (
                <p
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Leyendo el archivo…
                </p>
              )}

              {parseError && (
                <p
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {parseError}
                </p>
              )}

              {!parsing && !parseError && result && (
                <p className="text-sm text-muted-foreground" role="status">
                  Archivo leído: <strong>{validRowCount}</strong>{' '}
                  {validRowCount === 1 ? 'fila válida' : 'filas válidas'}
                  {errorCount > 0 && (
                    <>
                      {' '}
                      y <strong>{errorCount}</strong>{' '}
                      {errorCount === 1 ? 'fila con error' : 'filas con error'}
                    </>
                  )}
                  .
                </p>
              )}
            </div>
          )}

          {/* PASO 3 — Preview */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              {errorCount > 0 && (
                <div
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3"
                  role="alert"
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    {errorCount} {errorCount === 1 ? 'fila' : 'filas'} con problemas
                    (no se importarán)
                  </p>
                  <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto text-xs text-destructive">
                    {result?.errors.map((err, i) => (
                      <li key={`${err.row}-${i}`}>
                        Fila {err.row}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {validRowCount === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
                  <FileSpreadsheet
                    className="size-8 text-muted-foreground"
                    aria-hidden
                  />
                  <p className="text-sm text-muted-foreground">
                    No hay filas válidas para importar. Corrige el archivo y vuelve
                    al paso anterior.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Revisa las filas que se importarán (
                    <strong>{validRowCount}</strong> en total).
                  </p>
                  <div className="overflow-hidden rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {previewColumns.map((col) => (
                            <TableHead key={col.header} className={col.className}>
                              {col.header}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.map((row, rowIndex) => (
                          <TableRow key={rowIndex}>
                            {previewColumns.map((col) => (
                              <TableCell key={col.header} className={col.className}>
                                {col.render(row)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {hiddenRowCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      … y {hiddenRowCount}{' '}
                      {hiddenRowCount === 1 ? 'fila más' : 'filas más'} no mostradas.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* PASO 4 — Confirmar */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              {confirmState.status === 'done' ? (
                <div
                  className="flex flex-col items-center gap-3 rounded-md border border-primary/30 bg-primary/5 py-10 text-center"
                  role="status"
                >
                  <PartyPopper className="size-10 text-primary" aria-hidden />
                  <p className="text-base font-semibold">Importación completada</p>
                  <p className="text-sm text-muted-foreground">
                    Se importaron {validRowCount}{' '}
                    {validRowCount === 1 ? 'fila' : 'filas'} correctamente.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-muted/40 py-8 text-center">
                    <FileSpreadsheet className="size-8 text-primary" aria-hidden />
                    <p className="text-sm">
                      Estás a punto de importar <strong>{validRowCount}</strong>{' '}
                      {validRowCount === 1 ? 'fila' : 'filas'}.
                    </p>
                    {errorCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        ({errorCount} {errorCount === 1 ? 'fila' : 'filas'} con error
                        no se incluirán.)
                      </p>
                    )}
                  </div>
                  {confirmState.status === 'error' && (
                    <p
                      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                      role="alert"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {confirmState.message}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* NAVEGACIÓN */}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {step > 0 && !isDone && (
              <Button variant="ghost" onClick={goBack} disabled={isSaving}>
                <ArrowLeft aria-hidden />
                Atrás
              </Button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {isDone ? (
              <Button onClick={() => onOpenChange(false)}>
                <Check aria-hidden />
                Listo
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSaving}
                >
                  Cancelar
                </Button>
                {step < 3 ? (
                  <Button onClick={goNext} disabled={!canGoNext}>
                    Siguiente
                    <ArrowRight aria-hidden />
                  </Button>
                ) : confirmState.status === 'error' ? (
                  <Button onClick={handleConfirm} loading={isSaving}>
                    <RotateCcw aria-hidden />
                    Reintentar
                  </Button>
                ) : (
                  <Button
                    onClick={handleConfirm}
                    loading={isSaving}
                    disabled={validRowCount === 0}
                  >
                    {isSaving
                      ? 'Importando…'
                      : `Importar ${validRowCount} ${
                          validRowCount === 1 ? 'fila' : 'filas'
                        }`}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
