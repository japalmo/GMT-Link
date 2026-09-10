import { useEffect, useRef, useState, type ReactNode } from 'react';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ObraMap, ObraMapPoint, ObraPointStatus } from '@gmt-platform/contracts';

/**
 * Mapa satelital de la faena con los cercos como puntos. Los 63 cercos del
 * Cierre Perimetral están repartidos en 7,5 km: es la única vista donde se ve
 * de un golpe qué está listo, qué falta y dónde está trabajando la cuadrilla.
 *
 * En el tablero va de FONDO y el resto flota encima, así que acá no hay marco
 * ni leyenda: eso lo pone el tablero sobre el vidrio.
 *
 * Usa Leaflet crudo con import dinámico, igual que `gis-map` y `location-picker`:
 * `react-leaflet` no es dependencia del proyecto, y así Leaflet no entra en la
 * carga inicial.
 */

/**
 * Colores por estado. Van fijos y no por token del tema: el marcador se dibuja
 * sobre imagen satelital, no sobre una superficie de la aplicación. Los tres
 * tonos están elegidos para que la letra blanca encima se lea.
 */
export const COLOR_ESTADO: Record<ObraPointStatus, string> = {
  TERMINADO: '#16a34a',
  EN_EJECUCION: '#eab308',
  PENDIENTE: '#dc2626',
};

/** El amarillo necesita texto oscuro encima; los otros dos, blanco. */
const COLOR_LETRA: Record<ObraPointStatus, string> = {
  TERMINADO: '#ffffff',
  EN_EJECUCION: '#1c1917',
  PENDIENTE: '#ffffff',
};

export const NOMBRE_ESTADO: Record<ObraPointStatus, string> = {
  TERMINADO: 'Terminado',
  EN_EJECUCION: 'En ejecución',
  PENDIENTE: 'Pendiente',
};

/** Lo que el tablero puede pedirle al mapa desde sus propios botones. */
export interface ControlesMapa {
  acercar: () => void;
  alejar: () => void;
  encuadrar: () => void;
}

/** Qué cercos se dibujan. Un eje vacío no filtra. */
export interface FiltroMapa {
  estados: ObraPointStatus[];
  tipos: string[];
  sector: string | null;
}

export const SIN_FILTRO: FiltroMapa = { estados: [], tipos: [], sector: null };

export function pasaFiltro(p: ObraMapPoint, f: FiltroMapa): boolean {
  if (f.estados.length > 0 && !f.estados.includes(p.status)) return false;
  if (f.tipos.length > 0 && !f.tipos.includes(p.workType)) return false;
  if (f.sector && (p.sector ?? 'Sin sector') !== f.sector) return false;
  return true;
}

function escapar(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Marcador: disco del color del estado con la LETRA del tipo adentro. La letra
 * ahorra tener que memorizar formas, y el aro blanco con sombra lo despega del
 * terreno, que en Mantos Blancos tiene el mismo tono que cualquier gris.
 */
function iconoHtml(p: ObraMapPoint): string {
  const color = COLOR_ESTADO[p.status];
  const pulso =
    p.status === 'EN_EJECUCION'
      ? `<circle cx="16" cy="16" r="13" fill="${color}" opacity="0.45" class="pulso-cerco" />`
      : '';
  return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    ${pulso}
    <circle cx="16" cy="16" r="11" fill="${color}" stroke="#ffffff" stroke-width="2.5" />
    <text x="16" y="20.5" text-anchor="middle" font-family="system-ui, sans-serif"
          font-size="13" font-weight="700" fill="${COLOR_LETRA[p.status]}">${escapar(p.workType)}</text>
  </svg>`;
}

function popupHtml(p: ObraMapPoint): string {
  const etapa = p.currentStep
    ? `<div style="margin-top:5px">Ahora: <strong>${escapar(p.currentStep)}</strong></div>`
    : '';
  return `<div style="font-family:inherit;min-width:180px">
    <strong style="font-size:13px">Cerco ${escapar(p.code)}</strong>
    <div style="color:#64748b;font-size:11px">Tipo ${escapar(p.workType)}${
      p.sector ? ` · Sector ${escapar(p.sector)}` : ''
    }</div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:6px">
      <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${
        COLOR_ESTADO[p.status]
      }"></span>
      ${NOMBRE_ESTADO[p.status]} · ${p.stepsDone} de ${p.stepsTotal} etapas (${p.percent.toLocaleString(
        'es-CL',
      )}%)
    </div>${etapa}
  </div>`;
}

export function ObraMapa({
  mapa,
  filtro = SIN_FILTRO,
  onControles,
}: {
  mapa: ObraMap;
  filtro?: FiltroMapa;
  /**
   * Entrega el control del zoom al tablero. Los botones propios de Leaflet no
   * combinan con el vidrio, así que los dibuja el tablero y llama acá.
   */
  onControles?: (c: ControlesMapa | null) => void;
}): ReactNode {
  const contenedor = useRef<HTMLDivElement>(null);
  const instancia = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  // Contador que fuerza un reencuadre cuando el usuario aprieta el botón.
  const [encuadres, setEncuadres] = useState(0);
  const controles = useRef(onControles);
  controles.current = onControles;

  // Montaje. Una sola vez: los marcadores se redibujan por separado.
  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        const Lmod = (await import('leaflet')).default;
        if (!vivo || !contenedor.current || instancia.current) return;

        const mapaLocal = Lmod.map(contenedor.current, {
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: true,
          // Sin inercia el mapa se siente pesado al arrastrarlo en una TV táctil.
          inertia: true,
        });
        Lmod.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { attribution: 'Imagen satelital &copy; Esri', maxZoom: 19 },
        ).addTo(mapaLocal);
        instancia.current = mapaLocal;
        capa.current = Lmod.layerGroup().addTo(mapaLocal);
        setListo(true);
        controles.current?.({
          acercar: () => mapaLocal.zoomIn(),
          alejar: () => mapaLocal.zoomOut(),
          encuadrar: () => setEncuadres((n) => n + 1),
        });
      } catch {
        if (vivo) setError('No se pudo cargar el mapa satelital.');
      }
    })();

    return () => {
      vivo = false;
      controles.current?.(null);
      instancia.current?.remove();
      instancia.current = null;
      capa.current = null;
    };
  }, []);

  // Marcadores. Se redibujan al cambiar el avance o el filtro.
  useEffect(() => {
    if (!listo || !instancia.current || !capa.current) return;
    let vivo = true;

    void (async () => {
      const Lmod = (await import('leaflet')).default;
      const grupo = capa.current;
      const mapaL = instancia.current;
      if (!vivo || !grupo || !mapaL) return;

      const visibles = mapa.points.filter((p) => pasaFiltro(p, filtro));
      grupo.clearLayers();
      for (const p of visibles) {
        Lmod.marker([p.lat, p.lng], {
          icon: Lmod.divIcon({
            html: iconoHtml(p),
            className: 'marcador-cerco',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
          title: `Cerco ${p.code}`,
          keyboard: false,
          riseOnHover: true,
        })
          .bindPopup(popupHtml(p))
          .addTo(grupo);
      }

      // El encuadre sigue al filtro: si se pide un sector, el mapa va ahí.
      // El margen NO es parejo: arriba van los indicadores, a la derecha las
      // tarjetas y abajo a la izquierda la leyenda. Sin esto los cercos quedan
      // debajo del vidrio, que es justo donde no se ven.
      const encuadrar = visibles.length > 0 ? visibles : mapa.points;
      if (encuadrar.length > 0) {
        const ancho = mapaL.getSize().x;
        const amplio = ancho >= 1000;
        mapaL.fitBounds(
          Lmod.latLngBounds(encuadrar.map((p) => [p.lat, p.lng] as [number, number])),
          {
            paddingTopLeft: amplio ? [40, 110] : [40, 40],
            paddingBottomRight: amplio ? [470, 60] : [40, 40],
            maxZoom: 17,
            animate: true,
          },
        );
      } else {
        mapaL.setView([-23.44, -70.06], 13);
      }
      // El contenedor cambia de tamaño al montar dentro del layout: sin esto
      // Leaflet dibuja sobre el tamaño viejo y quedan tiles en gris.
      window.setTimeout(() => mapaL.invalidateSize(), 60);
    })();

    return () => {
      vivo = false;
    };
  }, [listo, mapa, filtro, encuadres]);

  return (
    // `z-0` con posición crea contexto de apilado y encierra los paneles de
    // Leaflet, que van en z-index 400 a 1000 y si no tapan todo el vidrio.
    <div className="absolute inset-0 z-0">
      <div ref={contenedor} className="size-full" />
      {error && (
        <p className="absolute inset-0 flex items-center justify-center bg-slate-900/80 p-4 text-center text-sm text-white">
          {error}
        </p>
      )}
    </div>
  );
}
