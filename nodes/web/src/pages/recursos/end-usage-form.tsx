import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapPin, LocateFixed, ArrowRightLeft, ImagePlus, AlertCircle, Loader2 } from 'lucide-react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { EndUsageCycleInput, UsageEndKind } from '@/types/assets';

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

export interface EndUsageFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Usuarios candidatos para un traspaso. */
  users: UserOption[];
  /**
   * Titular del ciclo (quien tiene el uso): se excluye de la lista de traspaso para
   * no traspasarle el activo de vuelta a sí mismo. Ojo: es el titular, NO quien cierra
   * el ciclo (un admin puede cerrar el ciclo de otro).
   */
  currentUserId?: string;
  /** Envía el cierre. Debe lanzar si falla para mantener el diálogo abierto. */
  onSubmit: (dto: EndUsageCycleInput, photo?: File) => Promise<void>;
}

/**
 * Diálogo "Terminar uso": cierra un ciclo EN_CURSO con GPS / estacionamiento /
 * traspaso, más una foto final opcional. La validación mínima vive en la UI (GPS
 * exige ubicación; traspaso exige elegir usuario); el backend revalida.
 */
export function EndUsageForm({
  open,
  onOpenChange,
  users,
  currentUserId,
  onSubmit,
}: EndUsageFormProps): ReactNode {
  const [endKind, setEndKind] = useState<UsageEndKind>('GPS');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [parkingText, setParkingText] = useState('');
  const [handoffToUserId, setHandoffToUserId] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reinicia el formulario cada vez que se abre para no arrastrar estado previo.
  useEffect(() => {
    if (open) {
      setEndKind('GPS');
      setCoords(null);
      setGeoLoading(false);
      setGeoError(null);
      setParkingText('');
      setHandoffToUserId('');
      setPhoto(null);
      setError(null);
      setSubmitting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  // Excluye al titular del ciclo (currentUserId): no tiene sentido traspasarle el
  // activo de vuelta a quien ya lo tenía.
  const handoffCandidates = users.filter((u) => u.id !== currentUserId);

  const requestLocation = () => {
    setGeoError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Tu dispositivo no permite obtener la ubicación.');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError('Permiso de ubicación denegado. Habilítalo o usa otra forma de cierre.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoError('No se pudo determinar tu ubicación en este momento.');
        } else {
          setGeoError('No se pudo obtener la ubicación. Intenta nuevamente.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    let dto: EndUsageCycleInput;
    if (endKind === 'GPS') {
      if (!coords) {
        setError('Obtén tu ubicación antes de terminar el uso.');
        return;
      }
      dto = { endKind, latitude: coords.latitude, longitude: coords.longitude };
    } else if (endKind === 'ESTACIONAMIENTO') {
      const text = parkingText.trim();
      if (text === '') {
        setError('Indica dónde quedó estacionado el activo.');
        return;
      }
      dto = { endKind, text };
    } else {
      if (handoffToUserId === '') {
        setError('Elige a quién le traspasas el activo.');
        return;
      }
      dto = { endKind, handoffToUserId };
    }

    setSubmitting(true);
    try {
      await onSubmit(dto, photo ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo terminar el uso.');
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="sm:max-w-md">
        <ModalHeader>
          <ModalTitle>Terminar uso</ModalTitle>
          <ModalDescription>
            Registra cómo dejas el activo. La foto final es opcional.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="end-kind">Forma de cierre</Label>
            <Select
              id="end-kind"
              aria-label="Forma de cierre del uso"
              value={endKind}
              onChange={(e) => {
                setEndKind(e.target.value as UsageEndKind);
                setError(null);
              }}
            >
              <option value="GPS">Ubicación GPS</option>
              <option value="ESTACIONAMIENTO">Estacionamiento</option>
              <option value="TRASPASO">Traspaso a otro usuario</option>
            </Select>
          </div>

          {endKind === 'GPS' && (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={requestLocation}
                disabled={geoLoading}
                className="self-start"
              >
                {geoLoading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <LocateFixed className="size-3.5" aria-hidden />
                )}
                {coords ? 'Actualizar mi ubicación' : 'Obtener mi ubicación'}
              </Button>
              {coords && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 text-primary" aria-hidden />
                  <span className="font-mono">
                    {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
                  </span>
                </p>
              )}
              {geoError && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {geoError}
                </p>
              )}
            </div>
          )}

          {endKind === 'ESTACIONAMIENTO' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="parking-text">¿Dónde quedó?</Label>
              <Textarea
                id="parking-text"
                value={parkingText}
                onChange={(e) => setParkingText(e.target.value)}
                placeholder="Ej. Estacionamiento subterráneo, nivel -2, junto a bodega."
                rows={3}
              />
            </div>
          )}

          {endKind === 'TRASPASO' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="handoff-user">Traspasar a</Label>
              <Select
                id="handoff-user"
                aria-label="Usuario que recibe el activo"
                value={handoffToUserId}
                onChange={(e) => setHandoffToUserId(e.target.value)}
              >
                <option value="">Selecciona un usuario</option>
                {handoffCandidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </Select>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                El activo queda disponible para esa persona, que hará su propio
                checklist al reportar su uso.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="end-photo">Foto final (opcional)</Label>
            <input
              ref={fileRef}
              id="end-photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
            />
            {photo && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ImagePlus className="size-3.5 text-primary" aria-hidden />
                {photo.name}
              </p>
            )}
          </div>

          {error && (
            <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <ModalFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Terminar uso
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
