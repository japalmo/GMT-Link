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

/** Dónde cae un punto dentro del mundo teselado, en píxeles, a un zoom dado. */
function pixelesDe(lat: number, lng: number, z: number): { x: number; y: number } {
  const mundo = 256 * 2 ** z;
  const sen = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * mundo,
    y: (0.5 - Math.log((1 + sen) / (1 - sen)) / (4 * Math.PI)) * mundo,
  };
}

const ANCHO_VISTA = 264;
const ALTO_VISTA = 132;
// 17 y no 18: sobre el desierto de Mantos Blancos, Esri no tiene imagen a
// zoom 18 y devuelve una tesela gris plana. 17 es el último con detalle real.
const ZOOM_VISTA = 17;

/**
 * Vista satelital del área del cerco, armada con las mismas teselas del mapa.
 * El servicio de Esri no expone exportación de imagen para este layer, así que
 * el recorte se hace con cuatro teselas desplazadas hasta dejar el cerco al
 * centro: es imagen real del terreno, no una miniatura genérica.
 */
function vistaSatelitalHtml(p: ObraMapPoint): string {
  const { x, y } = pixelesDe(p.lat, p.lng, ZOOM_VISTA);
  const x0 = Math.floor((x - ANCHO_VISTA / 2) / 256);
  const y0 = Math.floor((y - ALTO_VISTA / 2) / 256);
  const izq = -(x - ANCHO_VISTA / 2 - x0 * 256);
  const arriba = -(y - ALTO_VISTA / 2 - y0 * 256);

  let teselas = '';
  for (let dy = 0; dy < 2; dy += 1) {
    for (let dx = 0; dx < 2; dx += 1) {
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM_VISTA}/${y0 + dy}/${x0 + dx}`;
      teselas += `<img src="${url}" alt="" width="256" height="256" loading="lazy"
        style="position:absolute;left:${dx * 256}px;top:${dy * 256}px" />`;
    }
  }

  return `<div style="position:absolute;inset:0;transform:translate(${izq}px,${arriba}px)">${teselas}</div>
    <span style="position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;
      border-radius:9999px;border:2px solid #fff;box-shadow:0 0 0 2px rgba(15,23,42,.55)"></span>`;
}

/**
 * Ficha del cerco. Muestra el área y el estado de la SEMANA que se esté
 * mirando: retroceder en el tablero retrocede también esta ventana.
 */
function popupHtml(p: ObraMapPoint, pie: string, foto: { url: string; date: string } | null): string {
  const etapa = p.currentStep
    ? `<div style="margin-top:4px">Ahora: <strong>${escapar(p.currentStep)}</strong></div>`
    : '';
  const medio = foto
    ? `<img src="${escapar(foto.url)}" alt="Avance del cerco ${escapar(p.code)}"
         style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />`
    : vistaSatelitalHtml(p);
  const rotulo = foto ? `Foto de avance · ${escapar(foto.date)}` : 'Vista satelital del área';

  return `<div style="font-family:inherit;width:${ANCHO_VISTA}px">
    <div style="position:relative;width:${ANCHO_VISTA}px;height:${ALTO_VISTA}px;overflow:hidden;
      border-radius:8px;background:#1e293b">
      ${medio}
      <span style="position:absolute;left:0;right:0;bottom:0;padding:3px 6px;font-size:10px;
        color:#f1f5f9;background:linear-gradient(transparent,rgba(2,6,23,.85))">${rotulo}</span>
    </div>
    <strong style="display:block;margin-top:6px;font-size:13px">Cerco ${escapar(p.code)}</strong>
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
    <div style="margin-top:5px;color:#64748b;font-size:11px">${escapar(pie)}</div>
  </div>`;
}

export function ObraMapa({
  mapa,
  filtro = SIN_FILTRO,
  corte,
  onControles,
}: {
  mapa: ObraMap;
  filtro?: FiltroMapa;
  /** Qué semana se está mirando, para rotular la ficha y elegir la foto. */
  corte?: { etiqueta: string; hasta: string };
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
          .bindPopup(
            popupHtml(
              p,
              corte?.etiqueta ?? 'Estado a hoy',
              // La foto que correspondía a esa fecha: la más nueva anterior al
              // cierre de la semana. Antes de la primera, ninguna.
              p.photos.find((f) => !corte || f.date <= corte.hasta) ?? null,
            ),
            { minWidth: ANCHO_VISTA, maxWidth: ANCHO_VISTA + 24 },
          )
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
            // Arriba los indicadores, a la izquierda clima y leyenda, a la
            // derecha las tarjetas y abajo la curva: sin este margen desparejo
            // los cercos quedan justo debajo del vidrio.
            paddingTopLeft: amplio ? [300, 130] : [40, 40],
            paddingBottomRight: amplio ? [450, 230] : [40, 40],
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
  }, [listo, mapa, filtro, corte, encuadres]);

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
