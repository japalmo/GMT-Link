import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { errorToMessage, updateAsset } from '@/lib/api';
import type {
  AssetIdentifierType,
  AssetView,
  UpdateAssetInput,
  VehicleSubtype,
} from '@/types/assets';
import { IDENTIFIER_TYPE_LABELS, VEHICLE_SUBTYPE_LABELS } from '@/types/assets';
import { toast } from 'sonner';

const VEHICLE_SUBTYPES: ReadonlyArray<VehicleSubtype> = ['PICKUP', 'FURGON', 'AUTO', 'AUTOBUS', 'CAMION'];

/** Metadata conocida por tipo de activo (misma forma que la ficha de lectura). */
interface AssetMetadata {
  chargeCycles?: number | string;
  calibrationDate?: string;
  odometerKm?: number | string;
  plateCode?: string;
  year?: number | string;
}

interface FormState {
  name: string;
  description: string;
  manufacturer: string;
  identifier: string;
  identifierType: '' | AssetIdentifierType;
  vehicleSubtype: '' | VehicleSubtype;
  // Metadata por tipo (todo como string para inputs controlados).
  chargeCycles: string;
  calibrationDate: string;
  odometerKm: string;
  plateCode: string;
  year: string;
}

function seed(asset: AssetView): FormState {
  const meta = (asset.metadata ?? {}) as AssetMetadata;
  return {
    name: asset.name,
    description: asset.description ?? '',
    manufacturer: asset.manufacturer ?? '',
    identifier: asset.identifier ?? '',
    identifierType: asset.identifierType ?? '',
    vehicleSubtype: asset.vehicleSubtype ?? '',
    chargeCycles: meta.chargeCycles != null ? String(meta.chargeCycles) : '',
    calibrationDate: meta.calibrationDate ?? '',
    odometerKm: meta.odometerKm != null ? String(meta.odometerKm) : '',
    plateCode: meta.plateCode ?? '',
    year: meta.year != null ? String(meta.year) : '',
  };
}

/** Convierte un string numérico a number; undefined si vacío o inválido. */
function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Diálogo de edición de los campos DESCRIPTIVOS de un activo (Tanda 5.2): nombre,
 * descripción, fabricante, identificador/tipo, subtipo de vehículo y metadata por
 * tipo (EQUIPO/MAQUINARIA: ciclos + calibración; VEHICULO: km + patente + año). El
 * tipo y el proyecto NO se editan aquí. Llama a `PATCH /assets/:id`.
 */
export function AssetEditDialog({
  open,
  asset,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  asset: AssetView;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: AssetView) => void;
}): ReactNode {
  const baseId = useId();
  const [form, setForm] = useState<FormState>(() => seed(asset));
  const [wasOpen, setWasOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-siembra en la transición cerrado -> abierto (el diálogo se monta persistente):
  // así reabrir el MISMO activo tras Cancelar descarta las ediciones abandonadas.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(seed(asset));
      setError(null);
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const isVehicle = asset.type === 'VEHICULO';
  const isEquipoOrMaq = asset.type === 'EQUIPO' || asset.type === 'MAQUINARIA';

  function buildMetadata(): Record<string, unknown> {
    const base = { ...((asset.metadata ?? {}) as Record<string, unknown>) };
    if (isVehicle) {
      // Campo vacío: conserva el km existente (no lo baja a 0).
      const km = toNumber(form.odometerKm);
      if (km !== undefined) base.odometerKm = km;
      base.plateCode = form.plateCode.trim() || null;
      base.year = toNumber(form.year) ?? null;
    } else if (isEquipoOrMaq) {
      const cycles = toNumber(form.chargeCycles);
      if (cycles !== undefined) base.chargeCycles = cycles;
      base.calibrationDate = form.calibrationDate || null;
    }
    return base;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (form.name.trim().length === 0) {
      setError('El nombre del activo es obligatorio.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const input: UpdateAssetInput = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        identifier: form.identifier.trim() || null,
        identifierType: form.identifierType === '' ? null : form.identifierType,
        vehicleSubtype: isVehicle ? (form.vehicleSubtype === '' ? null : form.vehicleSubtype) : null,
        metadata: buildMetadata(),
      };
      const updated = await updateAsset(asset.id, input);
      toast.success('Activo actualizado.');
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo actualizar el activo.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <ModalContent className="sm:max-w-2xl">
        <ModalHeader>
          <ModalTitle>Editar activo</ModalTitle>
          <ModalDescription>
            Edita los datos descriptivos. El tipo y el proyecto no se cambian aquí; el estado, el
            responsable y el uso tienen sus propias acciones.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${baseId}-name`}>Nombre</Label>
              <Input
                id={`${baseId}-name`}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${baseId}-desc`}>Descripción</Label>
              <Textarea
                id={`${baseId}-desc`}
                rows={2}
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-manu`}>Fabricante / marca</Label>
              <Input
                id={`${baseId}-manu`}
                value={form.manufacturer}
                onChange={(e) => update('manufacturer', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-idtype`}>Tipo de identificador</Label>
              <Select
                id={`${baseId}-idtype`}
                aria-label="Tipo de identificador"
                value={form.identifierType}
                onChange={(e) => update('identifierType', e.target.value as '' | AssetIdentifierType)}
              >
                <option value="">Sin especificar</option>
                <option value="PATENTE">{IDENTIFIER_TYPE_LABELS.PATENTE}</option>
                <option value="NUMERO_SERIE">{IDENTIFIER_TYPE_LABELS.NUMERO_SERIE}</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${baseId}-id`}>Identificador (patente / número de serie)</Label>
              <Input
                id={`${baseId}-id`}
                value={form.identifier}
                onChange={(e) => update('identifier', e.target.value)}
              />
            </div>

            {isVehicle && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${baseId}-subtype`}>Tipo de vehículo</Label>
                <Select
                  id={`${baseId}-subtype`}
                  aria-label="Tipo de vehículo"
                  value={form.vehicleSubtype}
                  onChange={(e) => update('vehicleSubtype', e.target.value as '' | VehicleSubtype)}
                >
                  <option value="">Sin especificar</option>
                  {VEHICLE_SUBTYPES.map((s) => (
                    <option key={s} value={s}>
                      {VEHICLE_SUBTYPE_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {/* Metadata por tipo. */}
          {isVehicle && (
            <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${baseId}-km`}>Kilometraje</Label>
                <Input
                  id={`${baseId}-km`}
                  type="number"
                  min={0}
                  value={form.odometerKm}
                  onChange={(e) => update('odometerKm', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${baseId}-plate`}>Patente / matrícula</Label>
                <Input
                  id={`${baseId}-plate`}
                  value={form.plateCode}
                  onChange={(e) => update('plateCode', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${baseId}-year`}>Año</Label>
                <Input
                  id={`${baseId}-year`}
                  type="number"
                  min={1900}
                  value={form.year}
                  onChange={(e) => update('year', e.target.value)}
                />
              </div>
            </div>
          )}
          {isEquipoOrMaq && (
            <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${baseId}-cycles`}>Ciclos de uso</Label>
                <Input
                  id={`${baseId}-cycles`}
                  type="number"
                  min={0}
                  value={form.chargeCycles}
                  onChange={(e) => update('chargeCycles', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${baseId}-calib`}>Próxima calibración</Label>
                <Input
                  id={`${baseId}-calib`}
                  type="date"
                  value={form.calibrationDate}
                  onChange={(e) => update('calibrationDate', e.target.value)}
                />
              </div>
            </div>
          )}

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
              Guardar cambios
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
