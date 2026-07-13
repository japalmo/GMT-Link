import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Camera, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
import { ApiError, errorToMessage, listAssets, scanReceipt } from '@/lib/api';
import type { AssetView } from '@/types/assets';
import {
  REIMBURSEMENT_CATEGORY_LABELS,
  VEHICLE_SUBCATEGORY_LABELS,
  type CreateReimbursementInput,
  type ReimbursementCategory,
  type VehicleSubcategory,
} from '@/types/finance';
import { todaySantiagoString } from '@/lib/santiago-time';

/** MIME de imagen aceptado por el OCR/boleta (alineado con el backend). */
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic';
const CATEGORY_ORDER: ReimbursementCategory[] = [
  'ALIMENTACION',
  'TRANSPORTE',
  'VEHICULOS',
  'OTROS',
];
const SUBCATEGORY_ORDER: VehicleSubcategory[] = [
  'COMBUSTIBLE',
  'MANTENCION_LIMPIEZA',
  'REPUESTO',
  'OTRO',
];

/** Fecha de hoy (día calendario de Chile) en formato YYYY-MM-DD. */
function getTodayString(): string {
  return todaySantiagoString();
}

/** Mapea el string de categoría del OCR a nuestro enum (best-effort). */
function normalizeCategory(raw: string | undefined): ReimbursementCategory | '' {
  if (!raw) return '';
  const up = raw.toUpperCase();
  if (up.includes('ALIMENT') || up.includes('COMIDA') || up.includes('RESTAUR')) return 'ALIMENTACION';
  if (up.includes('TRANSP') || up.includes('TAXI') || up.includes('PASAJE')) return 'TRANSPORTE';
  if (up.includes('VEHIC') || up.includes('COMBUS') || up.includes('BENCINA') || up.includes('PETROLEO')) return 'VEHICULOS';
  return 'OTROS';
}

export interface ReembolsoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Crea el reembolso con su boleta OBLIGATORIA (un solo paso). Debe propagar el
   * error (el diálogo lo muestra y no se cierra).
   */
  onSubmit: (input: CreateReimbursementInput, receiptFile: File) => Promise<void>;
}

/**
 * Formulario de solicitud de reembolso (overlay, §5.5). La foto de la boleta
 * (subida o cámara en móvil) dispara el OCR (`scan-receipt`) que autocompleta
 * concepto/monto/categoría/fecha; el mismo archivo se adjunta como boleta al
 * crear. La categoría Vehículos habilita un selector de vehículo (assets
 * VEHICULO, con fallback a texto libre) y la subcategoría del gasto (resolución
 * #4: se envían `vehicle`/`subcategory` como strings). El botón que lo abre es
 * visible para todos (resolución #2).
 */
export function ReembolsoFormDialog({
  open,
  onOpenChange,
  onSubmit,
}: ReembolsoFormDialogProps): ReactNode {
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayString());
  const [category, setCategory] = useState<ReimbursementCategory | ''>('');
  const [vehicle, setVehicle] = useState('');
  const [vehicleSubcategory, setVehicleSubcategory] = useState<VehicleSubcategory | ''>('');
  const [observations, setObservations] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vehículos (assets VEHICULO): se cargan perezosamente al elegir "Vehículos".
  const [vehicles, setVehicles] = useState<AssetView[]>([]);
  const [vehiclesLoaded, setVehiclesLoaded] = useState(false);

  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setConcept('');
      setAmount('');
      setDate(getTodayString());
      setCategory('');
      setVehicle('');
      setVehicleSubcategory('');
      setObservations('');
      setReceiptFile(null);
      setError(null);
      setScanning(false);
    }
  }, [open]);

  // Carga perezosa de vehículos la primera vez que se selecciona la categoría.
  useEffect(() => {
    let active = true;
    if (category === 'VEHICULOS' && !vehiclesLoaded) {
      void (async () => {
        try {
          // Solo se necesita poblar el selector de vehículos: pedimos una página
          // amplia (tope 100) y usamos sus items (nuevo contrato paginado).
          const page = await listAssets({ type: 'VEHICULO', limit: 100 });
          if (active) setVehicles(page.items);
        } catch {
          if (active) setVehicles([]);
        } finally {
          if (active) setVehiclesLoaded(true);
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [category, vehiclesLoaded]);

  const handleScan = async (file: File): Promise<void> => {
    setScanning(true);
    setError(null);
    try {
      const res = await scanReceipt(file);
      if (res.concept) setConcept(res.concept);
      if (typeof res.amount === 'number' && res.amount > 0) setAmount(String(Math.round(res.amount)));
      if (res.date) setDate(res.date.slice(0, 10));
      const cat = normalizeCategory(res.category);
      if (cat) setCategory(cat);
    } catch (err) {
      // El backend responde 400 con "límite diario" al agotar la cuota (3/día).
      // Ese caso lleva su propio mensaje; cualquier otro error cae al genérico.
      const message = errorToMessage(err);
      if (err instanceof ApiError && message.includes('límite diario')) {
        setError(message);
      } else {
        setError('No se pudo leer la boleta automáticamente. Completa los campos a mano.');
      }
    } finally {
      setScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      setReceiptFile(file);
      void handleScan(file);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseInt(amount, 10);
    if (!concept.trim()) return setError('El concepto es obligatorio.');
    if (concept.trim().length > 200) return setError('El concepto no puede superar los 200 caracteres.');
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return setError('El monto debe ser un número entero mayor a cero.');
    }
    if (!date) return setError('La fecha es obligatoria.');
    if (!category) return setError('La categoría es obligatoria.');
    if (category === 'VEHICULOS' && !vehicle.trim()) return setError('Indica el vehículo.');
    if (category === 'VEHICULOS' && !vehicleSubcategory) {
      return setError('Selecciona la subcategoría del vehículo.');
    }
    if (!receiptFile) return setError('La boleta es obligatoria.');

    setSubmitting(true);
    try {
      await onSubmit(
        {
          concept: concept.trim(),
          amount: parsedAmount,
          date,
          category: REIMBURSEMENT_CATEGORY_LABELS[category],
          vehicle: category === 'VEHICULOS' ? vehicle.trim() : undefined,
          subcategory:
            category === 'VEHICULOS' && vehicleSubcategory
              ? VEHICLE_SUBCATEGORY_LABELS[vehicleSubcategory]
              : undefined,
          observations: observations.trim() || undefined,
        },
        receiptFile,
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el reembolso.');
    } finally {
      setSubmitting(false);
    }
  };

  const busy = scanning || submitting;

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Solicitar reembolso</ModalTitle>
          <ModalDescription>
            Sube o fotografía la boleta para autocompletar los datos, y revísalos antes de enviar.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
          {/* Boleta → OCR + adjunto */}
          <div className="flex flex-col gap-1.5">
            <Label>Boleta</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => uploadRef.current?.click()}
              >
                {scanning ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Upload className="size-4" aria-hidden />
                )}
                Subir imagen
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera className="size-4" aria-hidden />
                Tomar foto
              </Button>
              {receiptFile && !scanning && (
                <span className="text-xs text-muted-foreground truncate max-w-[12rem]" title={receiptFile.name}>
                  {receiptFile.name}
                </span>
              )}
            </div>
            {/* Aviso de espera: el OCR (NVIDIA) tarda varios segundos; se avisa al
                usuario para que no cierre ni reenvíe el formulario mientras corre. */}
            {scanning && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-foreground"
              >
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
                <span>
                  <span className="font-medium">Estamos interpretando la boleta…</span>{' '}
                  <span className="text-muted-foreground">
                    Puede tardar unos segundos. No cierres ni reenvíes el formulario mientras tanto.
                  </span>
                </span>
              </div>
            )}
            <input
              ref={uploadRef}
              type="file"
              accept={IMAGE_ACCEPT}
              className="sr-only"
              onChange={handleFileChange}
            />
            <input
              ref={cameraRef}
              type="file"
              accept={IMAGE_ACCEPT}
              capture="environment"
              className="sr-only"
              onChange={handleFileChange}
            />
          </div>

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
              <Label htmlFor="reim-date">Fecha de la boleta</Label>
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
            <Label htmlFor="reim-category">Categoría</Label>
            <Select
              id="reim-category"
              aria-label="Categoría del reembolso"
              value={category}
              onChange={(e) => setCategory(e.target.value as ReimbursementCategory | '')}
              required
              disabled={submitting}
            >
              <option value="">Selecciona una categoría...</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {REIMBURSEMENT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>

          {category === 'VEHICULOS' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reim-vehicle">Vehículo</Label>
                {vehicles.length > 0 ? (
                  <Select
                    id="reim-vehicle"
                    aria-label="Vehículo"
                    value={vehicle}
                    onChange={(e) => setVehicle(e.target.value)}
                    required
                    disabled={submitting}
                  >
                    <option value="">Selecciona un vehículo...</option>
                    {vehicles.map((v) => {
                      const label = `${v.name} (${v.code})`;
                      return (
                        <option key={v.id} value={label}>
                          {label}
                        </option>
                      );
                    })}
                  </Select>
                ) : (
                  <Input
                    id="reim-vehicle"
                    value={vehicle}
                    onChange={(e) => setVehicle(e.target.value)}
                    placeholder="Patente o código del vehículo"
                    required
                    disabled={submitting}
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reim-subcat">Subcategoría</Label>
                <Select
                  id="reim-subcat"
                  aria-label="Subcategoría del vehículo"
                  value={vehicleSubcategory}
                  onChange={(e) => setVehicleSubcategory(e.target.value as VehicleSubcategory | '')}
                  required
                  disabled={submitting}
                >
                  <option value="">Selecciona...</option>
                  {SUBCATEGORY_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {VEHICLE_SUBCATEGORY_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reim-observations">Observaciones (opcional)</Label>
            <Textarea
              id="reim-observations"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Notas adicionales"
              disabled={submitting}
            />
          </div>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={submitting} disabled={scanning}>
              Crear solicitud
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
