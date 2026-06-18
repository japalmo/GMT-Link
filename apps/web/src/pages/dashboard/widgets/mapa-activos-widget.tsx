import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Navigation, AlertCircle } from 'lucide-react';
import { ApiError, listAssets } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import type { AssetView } from '@/types/assets';
import { WidgetShell } from './widget-shell';

import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Mensaje legible de error. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/**
 * Widget "Mapa de Activos" (§6-2.1). Muestra un mapa interactivo (Leaflet puro)
 * centrado en los activos que tienen coordenadas de telemetría válidas.
 */
export function MapaActivosWidget(): ReactNode {
  const [LModule, setLModule] = useState<typeof L | null>(null);
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    import('leaflet').then((module) => {
      setLModule(module.default);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAssets();
      if (mountedRef.current) {
        setAssets(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los activos.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtrar activos con coordenadas de telemetría válidas
  const locatedAssets = assets.filter((asset) => {
    const loc = (asset.metadata as { location?: { latitude?: number; longitude?: number } } | null)?.location;
    return (
      loc &&
      typeof loc.latitude === 'number' &&
      typeof loc.longitude === 'number' &&
      !isNaN(loc.latitude) &&
      !isNaN(loc.longitude)
    );
  });

  // Inicializar mapa de Leaflet
  useEffect(() => {
    if (!LModule || loading || error || !mapContainerRef.current || mapRef.current) return;

    // Crear mapa (Santiago, Chile fallback inicial)
    const map = LModule.map(mapContainerRef.current, {
      center: [-33.4569, -70.6483],
      zoom: 11,
      zoomControl: false,
    });

    // Control del zoom abajo a la derecha
    LModule.control.zoom({ position: 'bottomright' }).addTo(map);

    // Voyager minimal basemap
    LModule.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CartoDB',
      maxZoom: 20,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [LModule, loading, error, locatedAssets.length]);

  // Sincronizar marcadores de activos ubicados
  useEffect(() => {
    const map = mapRef.current;
    if (!LModule || !map) return;

    // Limpiar marcadores viejos
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (locatedAssets.length === 0) {
      // Si no hay ninguno, centrar por defecto en Santiago
      map.setView([-33.4569, -70.6483], 11);
      return;
    }

    const bounds = LModule.latLngBounds([]);

    locatedAssets.forEach((asset) => {
      const loc = (asset.metadata as { location?: { latitude?: number; longitude?: number } }).location;
      if (!loc) return;
      const lat = loc.latitude;
      const lng = loc.longitude;
      if (lat === undefined || lng === undefined) return;
      const latLng: [number, number] = [lat, lng];

      bounds.extend(latLng);

      // Icono HTML personalizado (DivIcon)
      const iconHtml = `
        <div class="flex items-center justify-center size-8 rounded-full border-2 border-card shadow-lg bg-primary text-primary-foreground font-semibold">
          ${
            asset.type === 'VEHICULO'
              ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>'
              : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
          }
        </div>
      `;

      const customIcon = LModule.divIcon({
        html: iconHtml,
        className: 'custom-asset-marker',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
      });

      const speed = (asset.metadata as { speed?: number }).speed ?? 0;
      const statusColor =
        asset.status === 'DISPONIBLE'
          ? 'text-emerald-500 font-bold'
          : asset.status === 'EN_USO'
            ? 'text-blue-500 font-bold'
            : 'text-amber-500 font-bold';

      const popupHtml = `
        <div style="font-family: sans-serif; padding: 4px; font-size: 11px; min-width: 140px;">
          <p style="margin: 0; font-weight: bold; font-size: 13px; color: #0f172a;">${asset.name}</p>
          <p style="margin: 0 0 6px 0; font-family: monospace; font-size: 9px; color: #64748b;">${asset.code}</p>
          <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 4px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">Estado:</span>
              <span class="${statusColor}">${asset.status}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">Velocidad:</span>
              <span style="font-weight: bold; color: #0f172a;">${speed} km/h</span>
            </div>
          </div>
        </div>
      `;

      const marker = LModule.marker(latLng, { icon: customIcon })
        .bindPopup(popupHtml)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Ajustar zoom a todos los marcadores
    try {
      map.fitBounds(bounds, { padding: [40, 40] });
    } catch {
      // Ignorar fallas si la caja de límites está vacía o inválida
    }
  }, [LModule, locatedAssets, loading, error]);

  return (
    <WidgetShell
      title="Ubicación de Activos"
      description="Ubicación registrada de flota y equipos"
      icon={Navigation}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-4 h-56 justify-between select-none">
        {locatedAssets.length === 0 && !loading && !error ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center bg-accent/20 rounded-xl border border-dashed border-border p-4">
            <AlertCircle className="size-6 text-muted-foreground mb-1.5" />
            <p className="text-xs font-semibold text-foreground">Sin ubicación activa</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px]">
              No hay vehículos con coordenadas de georreferenciación cargadas.
            </p>
          </div>
        ) : (
          <div className="flex-1 w-full bg-accent/10 rounded-xl overflow-hidden border border-border relative">
            <div ref={mapContainerRef} className="w-full h-full z-0" />
            {locatedAssets.length > 0 && (
              <div className="absolute top-2 left-2 z-[10] bg-card/90 backdrop-blur-sm border border-border shadow px-2 py-1 rounded-md text-[9px] font-bold text-foreground">
                📍 {locatedAssets.length} activos ubicados
              </div>
            )}
          </div>
        )}

        {/* Footer link to resources catalog */}
        <div className="flex items-center justify-between border-t border-border/50 pt-2 shrink-0">
          <span className="text-[10px] text-muted-foreground font-medium">
            Límite velocidad: 100 km/h
          </span>
          <Link
            to="/recursos"
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'h-8 px-2 text-xs font-semibold text-primary hover:text-primary/80 hover:bg-primary/5' })}
          >
            Ver Activos →
          </Link>
        </div>
      </div>
    </WidgetShell>
  );
}
