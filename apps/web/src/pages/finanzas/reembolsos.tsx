import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Ban,
  Check,
  DollarSign,
  FileText,
  Loader2,
  Plus,
  Printer,
  RotateCw,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { useReimbursements } from '@/hooks/use-reimbursements';
import { downloadReimbursementsPdf } from '@/lib/api';
import { FinanceStatusBadge } from './finance-status-badge';
import { RejectDialog } from './reject-dialog';
import { formatCLP, formatDate } from '@/lib/format';
import type { CreateReimbursementInput } from '@/types/finance';
import { DOC_ACCEPT, validateFile } from '../perfil/file-field';
import { ImportWizard } from '@/components/primitives/import-wizard';
import type { ImportTemplateColumn } from '@/components/primitives/import-wizard';

/** Helper to get today's date in YYYY-MM-DD local format. */
function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TEMPLATE_COLUMNS: ImportTemplateColumn[] = [
  { key: 'concept', label: 'Concepto', example: 'Taxi a oficina' },
  { key: 'amount', label: 'Monto (CLP)', example: '15000' },
  { key: 'date', label: 'Fecha (AAAA-MM-DD)', example: '2026-06-15' },
  { key: 'category', label: 'Categoría (Opcional)', example: 'Transporte' },
];

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
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

interface NewReimbursementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateReimbursementInput) => Promise<void>;
}

function NewReimbursementDialog({
  open,
  onOpenChange,
  onSubmit,
}: NewReimbursementDialogProps): ReactNode {
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayString());
  const [category, setCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConcept('');
      setAmount('');
      setDate(getTodayString());
      setCategory('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseInt(amount, 10);
    if (!concept.trim()) {
      setError('El concepto es obligatorio.');
      return;
    }
    if (concept.trim().length > 200) {
      setError('El concepto no puede superar los 200 caracteres.');
      return;
    }
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('El monto debe ser un número entero mayor a cero.');
      return;
    }
    if (!date) {
      setError('La fecha es obligatoria.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        concept: concept.trim(),
        amount: parsedAmount,
        date,
        category: category.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el reembolso.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Solicitar reembolso</ModalTitle>
          <ModalDescription>
            Registra los detalles del gasto. Podrás adjuntar la boleta una vez creada la solicitud.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reim-concept">Concepto</Label>
            <Input
              id="reim-concept"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej. Almuerzo con cliente en Viña"
              required
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reim-amount">Monto (CLP)</Label>
              <Input
                id="reim-amount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ej. 15000"
                required
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reim-date">Fecha del gasto</Label>
              <Input
                id="reim-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reim-category">Categoría (opcional)</Label>
            <Input
              id="reim-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ej. Alimentación, Transporte"
              disabled={submitting}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={submitting}>
              Crear solicitud
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

interface PrintLayoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onPrint: (boletasPerPage: 2 | 4 | 6) => void;
}

function PrintLayoutDialog({
  open,
  onOpenChange,
  selectedCount,
  onPrint,
}: PrintLayoutDialogProps): ReactNode {
  const [layout, setLayout] = useState<2 | 4 | 6>(4);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Impresión en lote</ModalTitle>
          <ModalDescription>
            Configura la disposición de las {selectedCount} boletas seleccionadas por página. Se generará y descargará un PDF desde el servidor.
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-4 py-2">
          <Label>Boletas por página (distribución en grilla)</Label>
          <div className="grid grid-cols-3 gap-3">
            {[2, 4, 6].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setLayout(num as 2 | 4 | 6)}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-sm font-medium transition-all ${
                  layout === num
                    ? 'border-primary bg-primary/5 text-primary shadow-xs'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="text-lg font-bold">{num}</span>
                <span className="text-xs text-muted-foreground mt-1">Por página</span>
              </button>
            ))}
          </div>
        </div>

        <ModalFooter>
          <ModalClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </ModalClose>
          <Button
            type="button"
            onClick={() => {
              onPrint(layout);
              onOpenChange(false);
            }}
          >
            <Printer className="size-4" aria-hidden />
            Imprimir lote
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function ReembolsosTab(): ReactNode {
  const {
    mine,
    managerItems,
    isManager,
    loading,
    error,
    refetch,
    create,
    importBatch,
    attachReceipt,
    approve,
    reject,
    pay,
  } = useReimbursements();

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      await approve(id);
      toast.success('Reembolso aprobado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aprobar reembolso.');
    } finally {
      setActioning(null);
    }
  };

  const handlePay = async (id: string) => {
    if (actioning) return;
    setActioning(id);
    try {
      await pay(id);
      toast.success('Pago registrado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar pago.');
    } finally {
      setActioning(null);
    }
  };

  // Checkboxes for manager batch print
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [printLayoutOpen, setPrintLayoutOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAttachReceiptClick = (id: string): void => {
    setUploadingId(id);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || !uploadingId) {
      setUploadingId(null);
      return;
    }

    const validationError = validateFile(file, DOC_ACCEPT);
    if (validationError) {
      toast.error(validationError);
      setUploadingId(null);
      e.target.value = '';
      return;
    }

    try {
      await attachReceipt(uploadingId, file);
      toast.success('Boleta subida con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir el archivo de la boleta.');
    } finally {
      setUploadingId(null);
      e.target.value = '';
    }
  };

  const handleSelectToggle = (id: string): void => {
    setSelectedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSelectAllToggle = (): void => {
    const allSelected = managerItems.every((item) => selectedIds[item.id]);
    const next: Record<string, boolean> = {};
    if (!allSelected) {
      managerItems.forEach((item) => {
        next[item.id] = true;
      });
    }
    setSelectedIds(next);
  };

  const handlePrintBatch = async (layout: 2 | 4 | 6): Promise<void> => {
    const ids = managerItems
      .filter((item) => selectedIds[item.id] && item.receiptUrl)
      .map((item) => item.id);
    if (ids.length === 0) {
      toast.error('Selecciona al menos un reembolso con boleta adjunta.');
      return;
    }
    try {
      const blob = await downloadReimbursementsPdf(ids, layout);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'boletas-reembolsos.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('PDF generado con éxito.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar el PDF de boletas.');
    }
  };

  const selectedCount = Object.values(selectedIds).filter(Boolean).length;

  const parseReimbursementsCsv = async (
    file: File,
  ): Promise<{ rows: CreateReimbursementInput[]; errors: { row: number; message: string }[] }> => {
    const text = await file.text();
    const matrix = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
    if (matrix.length === 0) {
      return { rows: [], errors: [{ row: 0, message: 'El archivo está vacío.' }] };
    }

    const header = (matrix[0] ?? []).map((h) => h.trim());
    const idx = (key: string): number => header.indexOf(key);
    const required = ['concept', 'amount', 'date'];
    const missing = required.filter((k) => idx(k) === -1);
    if (missing.length > 0) {
      return {
        rows: [],
        errors: [{ row: 0, message: `Faltan columnas obligatorias en la cabecera: ${missing.join(', ')}.` }],
      };
    }

    const rows: CreateReimbursementInput[] = [];
    const errors: { row: number; message: string }[] = [];
    const cell = (r: string[], key: string): string => (r[idx(key)] ?? '').trim();

    for (let i = 1; i < matrix.length; i += 1) {
      const raw = matrix[i] ?? [];
      const rowNo = i + 1;
      const concept = cell(raw, 'concept');
      const amountStr = cell(raw, 'amount');
      const date = cell(raw, 'date');
      const category = cell(raw, 'category');

      const problems: string[] = [];
      if (concept.length === 0) problems.push('falta el concepto');
      if (concept.length > 200) problems.push('concepto supera 200 caracteres');

      const parsedAmount = parseInt(amountStr, 10);
      if (amountStr.length === 0 || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        problems.push('monto debe ser entero mayor a cero');
      }

      if (date.length === 0) {
        problems.push('falta la fecha');
      } else {
        const d = new Date(date);
        if (Number.isNaN(d.getTime())) {
          problems.push('fecha inválida (debe ser AAAA-MM-DD)');
        }
      }

      if (problems.length > 0) {
        errors.push({ row: rowNo, message: problems.join('; ') });
        continue;
      }

      rows.push({
        concept,
        amount: parsedAmount,
        date,
        category: category.length > 0 ? category : undefined,
      });
    }

    return { rows, errors };
  };

  const handleConfirmImport = async (rows: CreateReimbursementInput[]): Promise<void> => {
    await importBatch(rows);
  };

  if (loading) {
    return (
      <div className="flex animate-pulse flex-col gap-3" aria-hidden>
        <div className="h-10 rounded-md border border-border bg-muted/40" />
        <div className="h-14 rounded-md border border-border bg-muted/40" />
        <div className="h-14 rounded-md border border-border bg-muted/40" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-12 text-center"
      >
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <p className="max-w-sm text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RotateCw aria-hidden />
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Sección Mis Reembolsos */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Mis Reembolsos</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden />
              Importar CSV
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden />
              Solicitar Reembolso
            </Button>
          </div>
        </div>

        {mine.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-12 text-center">
            <FileText className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Aún no tienes solicitudes de reembolso registradas.</p>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden />
              Nueva solicitud
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Boleta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDate(item.date)}</TableCell>
                    <TableCell className="font-medium">{item.concept}</TableCell>
                    <TableCell className="text-muted-foreground">{item.category || '—'}</TableCell>
                    <TableCell>{formatCLP(item.amount)}</TableCell>
                    <TableCell>
                      <FinanceStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {item.receiptUrl ? (
                          <a
                            href={item.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <FileText className="size-3.5" aria-hidden />
                            Ver boleta
                          </a>
                        ) : item.status === 'PENDIENTE' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={uploadingId !== null}
                            onClick={() => handleAttachReceiptClick(item.id)}
                          >
                            {uploadingId === item.id ? (
                              <>
                                <Loader2 className="size-3 animate-spin" aria-hidden />
                                Subiendo...
                              </>
                            ) : (
                              <>
                                <Upload className="size-3" aria-hidden />
                                Subir boleta
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin boleta</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Sección de Gestión */}
      {isManager && (
        <section className="flex flex-col gap-4">
          <div className="border-t border-border pt-6 flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Gestión de Reembolsos</h2>
              <p className="text-sm text-muted-foreground">Aprobación, rechazo y pago de solicitudes de la organización.</p>
            </div>
            {selectedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-primary border-primary/45 hover:bg-primary/5"
                onClick={() => setPrintLayoutOpen(true)}
              >
                <Printer className="size-4" aria-hidden />
                Imprimir {selectedCount} boleta{selectedCount > 1 ? 's' : ''} en lote
              </Button>
            )}
          </div>

          {managerItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
              <p className="text-sm">No hay reembolsos pendientes ni registrados en el sistema.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        checked={managerItems.length > 0 && managerItems.every((item) => selectedIds[item.id])}
                        onChange={handleSelectAllToggle}
                      />
                    </TableHead>
                    <TableHead>Solicitante</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Boleta</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managerItems.map((item) => {
                    const name = item.requester
                      ? `${item.requester.firstName} ${item.requester.lastName}`
                      : '—';
                    return (
                      <TableRow key={item.id} className={selectedIds[item.id] ? 'bg-muted/30' : undefined}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="size-4 rounded border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            checked={!!selectedIds[item.id]}
                            onChange={() => handleSelectToggle(item.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{name}</span>
                            <span className="text-xs text-muted-foreground">{item.requester?.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell>{item.concept}</TableCell>
                        <TableCell>{formatCLP(item.amount)}</TableCell>
                        <TableCell>
                          <FinanceStatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>
                          {item.receiptUrl ? (
                            <a
                              href={item.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              <FileText className="size-3.5" aria-hidden />
                              Ver boleta
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sin boleta</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status === 'PENDIENTE' && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                                  onClick={() => void handleApprove(item.id)}
                                  disabled={actioning !== null}
                                >
                                  {actioning === item.id ? 'Procesando...' : (
                                    <>
                                      <Check className="size-3.5" aria-hidden />
                                      Aprobar
                                    </>
                                  )}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-destructive hover:bg-destructive/5"
                                  onClick={() => setRejectTargetId(item.id)}
                                  disabled={actioning !== null}
                                >
                                  <Ban className="size-3.5" aria-hidden />
                                  Rechazar
                                </Button>
                              </>
                            )}
                            {item.status === 'APROBADO' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                                onClick={() => void handlePay(item.id)}
                                disabled={actioning !== null}
                              >
                                {actioning === item.id ? 'Procesando...' : (
                                  <>
                                    <DollarSign className="size-3.5" aria-hidden />
                                    Registrar Pago
                                  </>
                                )}
                              </Button>
                            )}
                            {(item.status === 'PAGADO' || item.status === 'RECHAZADO') && (
                              <span className="text-xs text-muted-foreground italic">Completado</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* Hidden file input for attachment */}
      <input
        ref={fileInputRef}
        type="file"
        accept={DOC_ACCEPT}
        className="sr-only"
        onChange={(e) => void handleFileChange(e)}
      />

      <NewReimbursementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={create}
      />

      <ImportWizard<CreateReimbursementInput>
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Importar reembolsos"
        description="Carga tus reembolsos en lote subiendo un archivo CSV con el formato requerido."
        templateFileName="plantilla-reembolsos"
        templateColumns={TEMPLATE_COLUMNS}
        previewColumns={[
          { header: 'Concepto', render: (r) => r.concept },
          { header: 'Monto', className: 'tabular-nums text-right', render: (r) => formatCLP(r.amount) },
          { header: 'Fecha', render: (r) => formatDate(r.date) },
          { header: 'Categoría', render: (r) => r.category || '—' },
        ]}
        parseFile={parseReimbursementsCsv}
        onConfirm={handleConfirmImport}
      />

      <RejectDialog
        open={rejectTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTargetId(null);
        }}
        title="Rechazar reembolso"
        onConfirm={async (reason) => {
          if (actioning) return;
          if (rejectTargetId) {
            setActioning(rejectTargetId);
            try {
              await reject(rejectTargetId, reason);
              toast.success('Reembolso rechazado.');
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Error al rechazar reembolso.');
              throw err; // rethrow so that the dialog stays open and shows the error
            } finally {
              setActioning(null);
            }
          }
        }}
      />

      <PrintLayoutDialog
        open={printLayoutOpen}
        onOpenChange={setPrintLayoutOpen}
        selectedCount={selectedCount}
        onPrint={(layout) => void handlePrintBatch(layout)}
      />
    </div>
  );
}
