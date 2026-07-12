import { useCallback, useEffect, useRef, useState } from 'react';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

/** Ubicación seleccionada en el mapa. Todos los campos son opcionales. */
export interface LocationValue {
  latitude?: number;
  longitude?: number;
  address?: string;
}

export interface LocationPickerProps {
  /** Valor controlado ({ latitude, longitude, address }). */
  value: LocationValue;
  /** Se invoca al arrastrar el marcador, tocar el mapa o buscar una dirección. */
  onChange: (value: LocationValue) => void;
  /** Deshabilita la interacción (p. ej. mientras se envía el formulario). */
  disabled?: boolean;
  /** id del input de dirección, para asociar su `<Label htmlFor>`. */
  addressInputId?: string;
}

/** Centro por defecto del mapa (Chile) cuando aún no hay coordenadas. */
const DEFAULT_CENTER: [number, number] = [-33.45, -70.66];
const DEFAULT_ZOOM = 4;
const LOCATED_ZOOM = 15;

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

/** Resultado de la búsqueda directa de Nominatim (`/search`). */
interface NominatimSearchResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Resultado de la búsqueda inversa de Nominatim (`/reverse`). */
interface NominatimReverseResult {
  display_name?: string;
}

/**
 * Geocodificación inversa: coordenadas → dirección. Nominatim es gratuito y sin
 * API key; respetamos su política llamándolo solo en acciones explícitas del
 * usuario (soltar el marcador / tocar el mapa), nunca por cada tecla.
 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url = `${NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=es`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('reverse geocoding failed');
  const data = (await res.json()) as NominatimReverseResult;
  return data.display_name ?? null;
}

/**
 * Geocodificación directa: dirección → coordenadas. `limit=1` y acotado a Chile
 * (`countrycodes=cl`) según la política de uso de Nominatim.
 */
async function forwardGeocode(query: string): Promise<NominatimSearchResult | null> {
  const url = `${NOMINATIM_BASE}/search?format=json&q=${encodeURIComponent(
    query,
  )}&limit=1&countrycodes=cl&accept-language=es`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('forward geocoding failed');
  const data = (await res.json()) as NominatimSearchResult[];
  return data[0] ?? null;
}

/** Pin del marcador como `divIcon` (evita el problema de assets de los iconos
 * por defecto de Leaflet con bundlers; se colorea con `text-primary`). */
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" ' +
  'fill="currentColor" stroke="white" stroke-width="1.5" stroke-linejoin="round">' +
  '<path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10Z"/>' +
  '<circle cx="12" cy="11" r="2.25" fill="white" stroke="none"/></svg>';

function makeMarkerIcon(Lmod: typeof L): L.DivIcon {
  return Lmod.divIcon({
    className: 'gmt-location-pin',
    html: `<div class="text-primary drop-shadow-md">${PIN_SVG}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 30],
  });
}

/** Formatea una coordenada a 5 decimales para el pie del mapa. */
function fmtCoord(n: number): string {
  return n.toFixed(5);
}

/**
 * Selector de ubicación reutilizable con mapa Leaflet (tiles OpenStreetMap).
 * Un marcador arrastrable fija lat/lng y rellena la dirección por
 * geocodificación inversa; un campo de dirección con botón "Buscar en el mapa"
 * hace geocodificación directa y centra el mapa. Devuelve
 * `{ latitude, longitude, address }` vía `onChange`.
 *
 * Usa Leaflet crudo con import dinámico (mismo patrón que el mapa satelital de
 * V-Metric): `react-leaflet` no es dependencia del proyecto.
 */
export function LocationPicker({
  value,
  onChange,
  disabled = false,
  addressInputId = 'location-address',
}: LocationPickerProps) {
  const [leaflet, setLeaflet] = useState<typeof L | null>(null);
  const [searching, setSearching] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Refs con los últimos value/onChange/disabled para que los handlers de
  // Leaflet (creados una sola vez) no capturen valores obsoletos.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // Carga diferida de Leaflet.
  useEffect(() => {
    let active = true;
    void import('leaflet').then((mod) => {
      if (active) setLeaflet(mod.default);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Fija coords al instante y luego completa la dirección por reverse geocoding. */
  const handleMarkerMoved = useCallback(async (lat: number, lon: number) => {
    const prevAddress = valueRef.current.address;
    onChangeRef.current({ ...valueRef.current, latitude: lat, longitude: lon });
    try {
      const address = await reverseGeocode(lat, lon);
      onChangeRef.current({ latitude: lat, longitude: lon, address: address ?? prevAddress });
    } catch {
      // Silencioso: conservamos las coordenadas aunque el geocoding inverso falle.
    }
  }, []);

  // Inicialización del mapa (una sola vez, cuando Leaflet y el contenedor están
  // listos). Lee value/disabled vía refs para poder correr solo al montar.
  useEffect(() => {
    if (!leaflet || !containerRef.current || mapRef.current) return;
    const Lmod = leaflet;
    const initial = valueRef.current;
    const hasCoords = initial.latitude !== undefined && initial.longitude !== undefined;
    const center: [number, number] = hasCoords
      ? [initial.latitude as number, initial.longitude as number]
      : DEFAULT_CENTER;

    const map = Lmod.map(containerRef.current, {
      center,
      zoom: hasCoords ? LOCATED_ZOOM : DEFAULT_ZOOM,
      zoomControl: true,
    });
    Lmod.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      void handleMarkerMoved(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;

    // Leaflet debe recomputar su tamaño cuando aparece dentro de un modal animado.
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [leaflet, handleMarkerMoved]);

  // Sincroniza el marcador con las coordenadas del value: crea/mueve el pin, o
  // lo quita si las coordenadas se limpian (p. ej. al resetear el formulario).
  const { latitude, longitude } = value;
  useEffect(() => {
    const Lmod = leaflet;
    const map = mapRef.current;
    if (!Lmod || !map) return;

    if (latitude === undefined || longitude === undefined) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
    } else {
      const marker = Lmod.marker([latitude, longitude], {
        draggable: !disabled,
        icon: makeMarkerIcon(Lmod),
      });
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        void handleMarkerMoved(ll.lat, ll.lng);
      });
      marker.addTo(map);
      markerRef.current = marker;
      map.setView([latitude, longitude], Math.max(map.getZoom(), LOCATED_ZOOM));
    }
  }, [leaflet, latitude, longitude, disabled, handleMarkerMoved]);

  /** Geocodificación directa desde el campo de dirección. */
  const handleSearch = useCallback(async () => {
    const query = (valueRef.current.address ?? '').trim();
    if (!query) {
      setGeoError('Escribe una dirección para buscar en el mapa.');
      return;
    }
    setGeoError(null);
    setSearching(true);
    try {
      const result = await forwardGeocode(query);
      if (!result) {
        setGeoError('No se encontraron resultados para esa dirección.');
        return;
      }
      const lat = Number(result.lat);
      const lon = Number(result.lon);
      onChangeRef.current({ latitude: lat, longitude: lon, address: result.display_name });
      mapRef.current?.setView([lat, lon], LOCATED_ZOOM);
    } catch {
      setGeoError('No se pudo buscar la dirección. Revisa tu conexión e intenta nuevamente.');
    } finally {
      setSearching(false);
    }
  }, []);

  const hasCoords = latitude !== undefined && longitude !== undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={addressInputId}>
          Dirección <span className="text-muted-foreground">(opcional)</span>
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={addressInputId}
            value={value.address ?? ''}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSearch();
              }
            }}
            placeholder="Ej. Avenida Apoquindo 4800, Las Condes"
            disabled={disabled}
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleSearch()}
            loading={searching}
            disabled={disabled}
            className="shrink-0"
          >
            <Search aria-hidden />
            Buscar en el mapa
          </Button>
        </div>
      </div>

      {geoError && (
        <Alert variant="warning" live>
          {geoError}
        </Alert>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          role="application"
          aria-label="Mapa para seleccionar la ubicación"
          className="h-56 w-full overflow-hidden rounded-md border border-input bg-muted/40"
        />
        {!leaflet && (
          <div
            className="absolute inset-0 flex animate-pulse items-center justify-center rounded-md bg-muted/60 text-sm text-muted-foreground"
            aria-hidden
          >
            Cargando mapa…
          </div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" aria-hidden />
        {hasCoords ? (
          <span>
            Ubicación fijada: {fmtCoord(latitude)}, {fmtCoord(longitude)}. Arrastra el marcador para
            ajustar.
          </span>
        ) : (
          <span>Busca una dirección o toca el mapa para fijar la ubicación.</span>
        )}
      </p>
    </div>
  );
}
