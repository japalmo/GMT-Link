import { useEffect, useRef, useState, type ReactNode } from 'react';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ObraMap, ObraMapPoint, ObraPointStatus } from '@gmt-platform/contracts';

/**
 * Mapa satelital de la faena con los cercos como puntos. Los 63 cercos del
 * Cierre Perimetral están repartidos en 7,5 km: es la única vista donde se ve
 * de un golpe qué está listo, qué falta y dónde está trabajando la cuadrilla.
 *
 * Usa Leaflet crudo con import dinámico, igual que `gis-map` y `location-picker`:
 * `react-leaflet` no es dependencia del proyecto, y así el bundle de Leaflet no
 * entra en la carga inicial del tablero.
 */

/** Colores fijos: los paths SVG de Leaflet no resuelven variables del tema. */
const ESTADO: Record<ObraPointStatus, { color: string; label: string }> = {
  TERMINADO: { color: '#10b981', label: 'Terminado' },
  EN_EJECUCION: { color: '#f59e0b', label: 'En ejecución' },
  PENDIENTE: { color: '#94a3b8', label: 'Pendiente' },
};

/** Cada tipo de cerco tiene su forma, para distinguirlos sin leer la etiqueta. */
const FORMA: Record<string, string> = {
  // Círculo (A), rombo (B), hexágono (C).
  A: '<circle cx="14" cy="14" r="9" />',
  B: '<path d="M14 4 L24 14 L14 24 L4 14 Z" />',
  C: '<path d="M14 4 L22.7 9 L22.7 19 L14 24 L5.3 19 L5.3 9 Z" />',
};

function escapar(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Marcador SVG: forma según el tipo, relleno según el estado. El contorno es
 * blanco siempre y la sombra la pone el CSS: sobre imagen satelital, un borde
 * oscuro se confunde con el terreno y el marcador desaparece.
 */
function iconoHtml(p: ObraMapPoint, resaltado: boolean): string {
  const est = ESTADO[p.status];
  const forma = FORMA[p.workType] ?? FORMA.A;
  const pulso =
    p.status === 'EN_EJECUCION'
      ? `<circle cx="14" cy="14" r="12" fill="${est.color}" opacity="0.4" class="pulso-cerco" />`
      : '';
  return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    ${pulso}
    <g fill="${est.color}" stroke="#ffffff" stroke-width="${resaltado ? 2.5 : 2}">${forma}</g>
  </svg>`;
}

function popupHtml(p: ObraMapPoint): string {
  const est = ESTADO[p.status];
  const etapa = p.currentStep
    ? `<div style="margin-top:4px">Ahora: <strong>${escapar(p.currentStep)}</strong></div>`
    : '';
  return `<div style="font-family:inherit;min-width:170px">
    <strong style="font-size:13px">Cerco ${escapar(p.code)}</strong>
    <div style="color:#64748b;font-size:11px">Tipo ${escapar(p.workType)}${
      p.sector ? ` · Sector ${escapar(p.sector)}` : ''
    }</div>
    <div style="margin-top:6px">
      <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${
        est.color
      }"></span>
      ${est.label} · ${p.stepsDone} de ${p.stepsTotal} etapas (${p.percent
        .toLocaleString('es-CL')}%)
    </div>${etapa}
  </div>`;
}

export function ObraMapa({ mapa, alto }: { mapa: ObraMap; alto?: string }): ReactNode {
  const contenedor = useRef<HTMLDivElement>(null);
  const instancia = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  // Montaje del mapa. Se hace una sola vez: los marcadores se redibujan aparte.
  useEffect(() => {
    let vivo = true;
    let mapaLocal: L.Map | null = null;

    void (async () => {
      try {
        const Lmod = (await import('leaflet')).default;
        if (!vivo || !contenedor.current || instancia.current) return;

        mapaLocal = Lmod.map(contenedor.current, {
          zoomControl: true,
          attributionControl: true,
          // En la TV nadie va a interactuar; que el scroll no mueva el mapa solo.
          scrollWheelZoom: false,
        });
        Lmod.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Imagen satelital &copy; Esri',
            maxZoom: 19,
          },
        ).addTo(mapaLocal);

        instancia.current = mapaLocal;
        capa.current = Lmod.layerGroup().addTo(mapaLocal);
        setListo(true);
      } catch {
        if (vivo) setError('No se pudo cargar el mapa satelital.');
      }
    })();

    return () => {
      vivo = false;
      instancia.current?.remove();
      instancia.current = null;
      capa.current = null;
    };
  }, []);

  // Marcadores. Se redibujan cuando cambia el avance (la TV se refresca sola).
  useEffect(() => {
    if (!listo || !instancia.current || !capa.current) return;
    let vivo = true;

    void (async () => {
      const Lmod = (await import('leaflet')).default;
      const grupo = capa.current;
      const mapaL = instancia.current;
      if (!vivo || !grupo || !mapaL) return;

      grupo.clearLayers();
      for (const p of mapa.points) {
        const marcador = Lmod.marker([p.lat, p.lng], {
          icon: Lmod.divIcon({
            html: iconoHtml(p, p.status === 'EN_EJECUCION'),
            className: 'marcador-cerco',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
          title: `Cerco ${p.code}`,
          keyboard: false,
        });
        marcador.bindPopup(popupHtml(p));
        marcador.addTo(grupo);
      }

      if (mapa.points.length > 0) {
        const limites = Lmod.latLngBounds(mapa.points.map((p) => [p.lat, p.lng] as [number, number]));
        mapaL.fitBounds(limites, { padding: [28, 28], maxZoom: 16 });
      } else {
        // Sin cercos ubicados, al menos encuadrar la faena.
        mapaL.setView([-23.44, -70.06], 13);
      }
      // El contenedor cambia de alto al rotar los paneles: sin esto Leaflet
      // queda dibujando sobre el tamaño viejo y aparecen tiles en gris.
      window.setTimeout(() => mapaL.invalidateSize(), 60);
    })();

    return () => {
      vivo = false;
    };
  }, [listo, mapa]);

  const resumen = mapa.points.reduce(
    (acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }),
    {} as Record<ObraPointStatus, number>,
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        <div ref={contenedor} className="size-full" style={alto ? { height: alto } : undefined} />
        {error && (
          <p className="absolute inset-0 flex items-center justify-center bg-card/90 p-4 text-center text-sm text-muted-foreground">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(['TERMINADO', 'EN_EJECUCION', 'PENDIENTE'] as const).map((estado) => (
          <span key={estado} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: ESTADO[estado].color }}
              aria-hidden
            />
            {ESTADO[estado].label}
            <span className="font-semibold tabular-nums text-foreground">
              {resumen[estado] ?? 0}
            </span>
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <FormaLeyenda tipo="A" /> Tipo A
          <FormaLeyenda tipo="B" /> Tipo B
          <FormaLeyenda tipo="C" /> Tipo C
        </span>
        {mapa.unlocated > 0 && (
          <span>
            {mapa.unlocated} sin ubicación confirmada
          </span>
        )}
      </div>
    </div>
  );
}

/** Miniatura de la forma de cada tipo, para la leyenda. */
function FormaLeyenda({ tipo }: { tipo: 'A' | 'B' | 'C' }): ReactNode {
  const d = {
    A: null,
    B: 'M7 1 L13 7 L7 13 L1 7 Z',
    C: 'M7 1 L12.2 4 L12.2 10 L7 13 L1.8 10 L1.8 4 Z',
  }[tipo];
  return (
    <svg viewBox="0 0 14 14" className="size-3 fill-muted-foreground" aria-hidden>
      {d ? <path d={d} /> : <circle cx="7" cy="7" r="5.5" />}
    </svg>
  );
}
