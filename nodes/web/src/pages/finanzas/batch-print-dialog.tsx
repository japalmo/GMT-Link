import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  downloadReimbursementsPdf,
  listAllReimbursements,
  markReimbursementsPrinted,
  type PrintOrientation,
  type PrintPageSize,
} from '@/lib/api';
import { formatCLP, formatDate } from '@/lib/format';
import type { ReimbursementView } from '@/types/finance';

/** Trae TODOS los reembolsos de gestión (todas las páginas keyset), para poder
 *  seleccionar boletas más allá de la página visible de la tabla paginada. */
async function fetchAllManagerReimbursements(): Promise<ReimbursementView[]> {
  const all: ReimbursementView[] = [];
  let cursor: string | undefined;
  do {
    const page = await listAllReimbursements({ limit: 100, cursor });
    all.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

type PerPage = 2 | 4 | 6;
type SelectionMode = 'pending' | 'manual';
type Step = 'config' | 'preview';

export interface BatchPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras marcar impresas, para que el caller refresque la lista. */
  onPrinted: () => void;
}

/** ¿La URL apunta a una imagen (para la miniatura del preview)? */
function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|heic|gif)(\?|#|$)/i.test(url);
}

/**
 * Impresión en lote de boletas (§5.7). Gateada por `finance:print:batch` (el
 * caller monta el botón que la abre). Flujo: (1) seleccionar boletas (todas las
 * pendientes de impresión, según el flag `printed`, o selección manual) y elegir
 * boletas por hoja + orientación + tamaño; (2) previsualizar (miniaturas +
 * tabla concepto/monto/categoría/nombre); (3) confirmar → descarga el PDF
 * generado en el servidor y SOLO ENTONCES marca las boletas como impresas.
 */
export function BatchPrintDialog({
  open,
  onOpenChange,
  onPrinted,
}: BatchPrintDialogProps): ReactNode {
  // Se trae la lista COMPLETA de gestión al abrir (no la página visible de la
  // tabla), para poder imprimir todas las boletas pendientes aunque estén en
  // otras páginas del motor server-side.
  const [items, setItems] = useState<ReimbursementView[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const printable = useMemo(() => items.filter((i) => i.receiptUrl), [items]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [mode, setMode] = useState<SelectionMode>('pending');
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [perPage, setPerPage] = useState<PerPage>(4);
  const [orientation, setOrientation] = useState<PrintOrientation>('portrait');
  const [size, setSize] = useState<PrintPageSize>('A4');
  const [step, setStep] = useState<Step>('config');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Trae la lista completa de gestión (reintentable desde el botón de error). */
  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    setError(null);
    try {
      const all = await fetchAllManagerReimbursements();
      if (mountedRef.current) setItems(all);
    } catch {
      if (mountedRef.current) setError('No se pudieron cargar las boletas para imprimir.');
    } finally {
      if (mountedRef.current) setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setMode('pending');
      setManual({});
      setPerPage(4);
      setOrientation('portrait');
      setSize('A4');
      setStep('config');
      setDownloading(false);
      setError(null);
      setItems([]);
      return;
    }
    void loadItems();
  }, [open, loadItems]);

  /** Boletas efectivamente seleccionadas según el modo. */
  const selected = useMemo(() => {
    if (mode === 'pending') return printable.filter((i) => !i.printed);
    return printable.filter((i) => manual[i.id]);
  }, [mode, printable, manual]);

  const toggle = (id: string): void =>
    setManual((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleConfirm = async (): Promise<void> => {
    const ids = selected.map((i) => i.id);
    if (ids.length === 0) {
      setError('Selecciona al menos una boleta.');
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadReimbursementsPdf(ids, perPage, orientation, size);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'boletas-reembolsos.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Solo tras la descarga confirmada marcamos impresas.
      try {
        await markReimbursementsPrinted(ids);
      } catch {
        toast.warning('El PDF se descargó, pero no se pudieron marcar las boletas como impresas.');
      }
      toast.success(`PDF generado con ${ids.length} boleta${ids.length === 1 ? '' : 's'}.`);
      onPrinted();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el PDF de boletas.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => (downloading ? undefined : onOpenChange(next))}>
      <ModalContent className="sm:max-w-2xl">
        <ModalHeader>
          <ModalTitle>Impresión en lote</ModalTitle>
          <ModalDescription>
            {step === 'config'
              ? 'Selecciona las boletas y la disposición del PDF.'
              : `Revisa las ${selected.length} boleta${selected.length === 1 ? '' : 's'} antes de descargar.`}
          </ModalDescription>
        </ModalHeader>

        {loadingItems ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Cargando boletas…</div>
        ) : error && printable.length === 0 ? (
          <Alert variant="destructive" live>
            <div className="flex flex-col items-start gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadItems()}>
                Reintentar
              </Button>
            </div>
          </Alert>
        ) : printable.length === 0 ? (
          <Alert variant="default">No hay reembolsos con boleta adjunta para imprimir.</Alert>
        ) : step === 'config' ? (
          <div className="flex flex-col gap-4">
            {/* Modo de selección */}
            <div className="flex flex-col gap-2">
              <Label>Boletas a imprimir</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={mode === 'pending' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMode('pending')}
                >
                  Pendientes de impresión ({printable.filter((i) => !i.printed).length})
                </Button>
                <Button
                  type="button"
                  variant={mode === 'manual' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMode('manual')}
                >
                  Selección manual
                </Button>
              </div>
            </div>

            {mode === 'manual' && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {printable.map((i) => {
                    const name = i.requester
                      ? `${i.requester.firstName} ${i.requester.lastName}`
                      : '—';
                    return (
                      <li key={i.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            checked={!!manual[i.id]}
                            onChange={() => toggle(i.id)}
                          />
                          <span className="flex-1 truncate">
                            {name} · {i.concept}
                          </span>
                          <span className="tabular-nums text-muted-foreground">{formatCLP(i.amount)}</span>
                          {i.printed && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              Impresa
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Disposición */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bp-perpage">Boletas por hoja</Label>
                <Select
                  id="bp-perpage"
                  aria-label="Boletas por hoja"
                  value={String(perPage)}
                  onChange={(e) => setPerPage(Number(e.target.value) as PerPage)}
                >
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="6">6</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bp-orientation">Orientación</Label>
                <Select
                  id="bp-orientation"
                  aria-label="Orientación de la hoja"
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as PrintOrientation)}
                >
                  <option value="portrait">Vertical</option>
                  <option value="landscape">Horizontal</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bp-size">Tamaño</Label>
                <Select
                  id="bp-size"
                  aria-label="Tamaño de la hoja"
                  value={size}
                  onChange={(e) => setSize(e.target.value as PrintPageSize)}
                >
                  <option value="A4">A4</option>
                  <option value="letter">Carta</option>
                </Select>
              </div>
            </div>

            {error && (
              <Alert variant="destructive" live>
                {error}
              </Alert>
            )}
          </div>
        ) : (
          /* Preview */
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {selected.map((i) => (
                <div key={i.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
                  <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-muted">
                    {i.receiptUrl && isImageUrl(i.receiptUrl) ? (
                      <img
                        src={i.receiptUrl}
                        alt={`Boleta de ${i.concept}`}
                        className="size-full object-cover"
                      />
                    ) : (
                      <FileText className="size-6 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="text-xs">
                    <p className="truncate font-medium" title={i.concept}>
                      {i.concept}
                    </p>
                    <p className="tabular-nums text-muted-foreground">{formatCLP(i.amount)}</p>
                    <p className="truncate text-muted-foreground">{i.category || 'Sin categoría'}</p>
                    <p className="truncate text-muted-foreground">
                      {i.requester ? `${i.requester.firstName} ${i.requester.lastName}` : '—'}
                    </p>
                    <p className="text-muted-foreground">{formatDate(i.date)}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {perPage} por hoja · {orientation === 'portrait' ? 'Vertical' : 'Horizontal'} · {size === 'A4' ? 'A4' : 'Carta'}
            </p>
            {error && (
              <Alert variant="destructive" live>
                {error}
              </Alert>
            )}
          </div>
        )}

        <ModalFooter>
          {step === 'config' ? (
            <>
              <ModalClose asChild>
                <Button type="button" variant="outline">
                  Cancelar
                </Button>
              </ModalClose>
              <Button
                type="button"
                disabled={printable.length === 0 || selected.length === 0}
                onClick={() => {
                  setError(null);
                  setStep('preview');
                }}
              >
                Vista previa ({selected.length})
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={downloading}
                onClick={() => setStep('config')}
              >
                <ArrowLeft className="size-4" aria-hidden />
                Volver
              </Button>
              <Button type="button" loading={downloading} onClick={() => void handleConfirm()}>
                <Printer className="size-4" aria-hidden />
                Descargar e imprimir
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
