import { useEffect, useId, useRef, useState } from 'react';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Satellite } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Punto geográfico (WGS84) a graficar sobre el mapa. */
export interface GisMapPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface GisMapProps {
  /** Puntos convertidos a mostrar. Con 2 o más se dibuja el polígono que los une. */
  points: GisMapPoint[];
  /** Clase opcional del contenedor raíz. */
  className?: string;
}

/** Centro por defecto (Chile) cuando aún no hay puntos convertidos. */
const DEFAULT_CENTER: [number, number] = [-33.45, -70.66];
const DEFAULT_ZOOM = 4;
const SINGLE_POINT_ZOOM = 15;
const MAP_MAX_ZOOM = 19;

/** GIBS True Color (MODIS Terra) publica tiles solo hasta el nivel 9. */
const GIBS_MAX_NATIVE_ZOOM = 9;

/** Colores fijos de los overlays: los paths SVG de Leaflet no resuelven
 * variables CSS del tema, y estos tonos contrastan bien sobre cualquier capa. */
const MARKER_FILL = '#dc2626';
const SHAPE_COLOR = '#6366f1';

/** URL WMTS de NASA GIBS (True Color) para una fecha ISO (yyyy-mm-dd). */
function gibsUrl(isoDate: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${isoDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

/** Ayer en UTC (yyyy-mm-dd): GIBS publica la imagen diaria con desfase. */
function yesterdayIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Escape mínimo para el HTML del popup (los labels vienen de la app). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function popupHtml(point: GisMapPoint): string {
  const title = point.label ? `<strong>${escapeHtml(point.label)}</strong><br/>` : '';
  return `${title}<span style="font-family: monospace; font-size: 11px;">${point.lat.toFixed(
    6,
  )}, ${point.lng.toFixed(6)}</span>`;
}

/**
 * Mini GIS basado en Leaflet para análisis rápidos: capas base conmutables
 * (satelital Esri, OSM, topográfica y NASA GIBS con fecha elegible para
 * comparativas en el tiempo), marcadores con popup por punto convertido y
 * polígono de unión cuando hay 2 o más puntos.
 *
 * Usa Leaflet crudo con import dinámico (mismo patrón que `LocationPicker`):
 * `react-leaflet` no es dependencia del proyecto.
 */
export function GisMap({ points, className }: GisMapProps): React.ReactNode {
  const [leaflet, setLeaflet] = useState<typeof L | null>(null);
  const [gibsDate, setGibsDate] = useState<string>(yesterdayIso);
  const dateInputId = useId();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const gibsLayerRef = useRef<L.TileLayer | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  // Última fecha aplicada a la capa GIBS, para no redibujarla en el montaje.
  const appliedGibsDateRef = useRef<string>(gibsDate);

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

  // Inicialización del mapa (una sola vez, cuando Leaflet y el contenedor
  // están listos): capas base, control de capas y escala métrica.
  useEffect(() => {
    if (!leaflet || !containerRef.current || mapRef.current) return;
    const Lmod = leaflet;

    const map = Lmod.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      zoomControl: true,
    });

    const esri = Lmod.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics y la comunidad de usuarios GIS',
        maxZoom: MAP_MAX_ZOOM,
      },
    );
    const osm = Lmod.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: MAP_MAX_ZOOM,
    });
    const topo = Lmod.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution:
        'Datos: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Estilo: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      maxNativeZoom: 17,
      maxZoom: MAP_MAX_ZOOM,
    });
    const gibs = Lmod.tileLayer(gibsUrl(appliedGibsDateRef.current), {
      attribution:
        'Imágenes cortesía de <a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a>',
      maxNativeZoom: GIBS_MAX_NATIVE_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
    });

    esri.addTo(map);
    Lmod.control
      .layers(
        {
          'Satélite (Esri)': esri,
          'Mapa (OSM)': osm,
          'Topográfico': topo,
          'NASA GIBS (día)': gibs,
        },
        undefined,
        { position: 'topright' },
      )
      .addTo(map);
    Lmod.control.scale({ metric: true, imperial: false }).addTo(map);

    mapRef.current = map;
    gibsLayerRef.current = gibs;

    // Leaflet debe recomputar su tamaño si el contenedor cambia (layout responsive).
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      gibsLayerRef.current = null;
      overlayRef.current = null;
    };
  }, [leaflet]);

  // Comparativa en el tiempo: al cambiar la fecha se recarga la capa GIBS.
  // El ref se actualiza ANTES de comprobar la capa: si Leaflet aún está
  // cargando (capa null), la inicialización creará la capa con la fecha
  // vigente en vez de descartar el cambio en silencio.
  useEffect(() => {
    if (appliedGibsDateRef.current === gibsDate) return;
    appliedGibsDateRef.current = gibsDate;
    const gibs = gibsLayerRef.current;
    if (!gibs) return;
    gibs.setUrl(gibsUrl(gibsDate));
  }, [gibsDate]);

  // Sincroniza marcadores y polígono con los puntos convertidos.
  useEffect(() => {
    const Lmod = leaflet;
    const map = mapRef.current;
    if (!Lmod || !map) return;

    const overlay = overlayRef.current ?? Lmod.layerGroup().addTo(map);
    overlayRef.current = overlay;
    overlay.clearLayers();

    if (points.length === 0) return;

    const latLngs = points.map((p): [number, number] => [p.lat, p.lng]);

    if (points.length > 1) {
      const shapeOptions: L.PolylineOptions = {
        color: SHAPE_COLOR,
        weight: 2.5,
        opacity: 0.85,
        fillColor: SHAPE_COLOR,
        fillOpacity: 0.15,
        smoothFactor: 1.5,
      };
      const shape =
        points.length >= 3
          ? Lmod.polygon(latLngs, shapeOptions)
          : Lmod.polyline(latLngs, shapeOptions);
      shape.addTo(overlay);
    }

    points.forEach((point) => {
      Lmod.circleMarker([point.lat, point.lng], {
        radius: 6,
        color: '#ffffff',
        weight: 1.5,
        fillColor: MARKER_FILL,
        fillOpacity: 0.9,
      })
        .bindPopup(popupHtml(point))
        .addTo(overlay);
    });

    const first = points[0];
    if (points.length === 1 && first) {
      map.setView([first.lat, first.lng], SINGLE_POINT_ZOOM);
    } else {
      map.fitBounds(Lmod.latLngBounds(latLngs), { padding: [40, 40], maxZoom: 16 });
    }
  }, [leaflet, points]);

  const maxGibsDate = yesterdayIso();

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={dateInputId} className="text-xs">
            Fecha imagen NASA GIBS
          </Label>
          <Input
            id={dateInputId}
            type="date"
            value={gibsDate}
            max={maxGibsDate}
            onChange={(e) => {
              const value = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setGibsDate(value);
            }}
            className="h-8 w-auto text-xs"
          />
        </div>
        <p className="flex items-center gap-1.5 pb-1 text-[11px] text-muted-foreground">
          <Satellite className="size-3.5 shrink-0" aria-hidden />
          Activa la capa "NASA GIBS (día)" en el control de capas y cambia la fecha para
          comparar imágenes en el tiempo.
        </p>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          role="application"
          aria-label="Mapa GIS con los puntos convertidos"
          className="h-[460px] w-full overflow-hidden rounded-xl border border-border/80 bg-muted/40"
        />
        {!leaflet && (
          <div
            className="absolute inset-0 z-[500] flex animate-pulse items-center justify-center rounded-xl bg-muted/60 text-sm text-muted-foreground"
            role="status"
          >
            Cargando mapa…
          </div>
        )}
        {leaflet && points.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[1000] flex justify-center">
            <span className="rounded-full border border-border/70 bg-background/90 px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur-sm">
              Convierte coordenadas para verlas en el mapa
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
