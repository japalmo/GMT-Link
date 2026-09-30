import { useEffect, useState, type ReactNode } from 'react';
import {
  GripVertical,
  Locate,
  RotateCcw,
  Sun,
  Thermometer,
  TriangleAlert,
  Wind,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ObraWeather } from '@gmt-platform/contracts';
import type { ControlesMapa } from './obra-mapa';
import { useArrastrable, type Desplazamiento } from './usar-arrastre';

/**
 * Piezas sueltas del tablero de obra: el envoltorio que hace arrastrable un
 * bloque, los controles del mapa con el estilo del tablero y el panel de
 * condiciones en faena. Viven aparte para que el tablero se lea.
 */

/** ¿Estamos en el layout flotante (mapa de fondo)? Solo ahí se arrastra. */
export function useLayoutFlotante(): boolean {
  const [flotante, setFlotante] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setFlotante(mq.matches);
    const cambio = (e: MediaQueryListEvent) => setFlotante(e.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  return flotante;
}

/**
 * Envoltorio que hace arrastrable un bloque del tablero. El asa es una pestaña
 * chica que aparece al acercar el puntero; en los bloques sin encabezado propio
 * (`asaCompleta`) se arrastra desde cualquier parte.
 *
 * Apilado (móvil) no se mueve nada: el orden es el que hay.
 */
export function Arrastrable({
  id,
  posiciones,
  onMover,
  children,
  asaCompleta = false,
  columna = false,
}: {
  id: string;
  posiciones: Record<string, Desplazamiento>;
  onMover: (id: string, d: Desplazamiento) => void;
  children: ReactNode;
  asaCompleta?: boolean;
  columna?: boolean;
}): ReactNode {
  const flotante = useLayoutFlotante();
  const { estilo, asa, arrastrando } = useArrastrable(id, posiciones[id], onMover, flotante);

  return (
    <div
      className={`group/arrastre relative ${
        columna ? 'flex min-h-0 flex-1 flex-col gap-2 sm:gap-3' : ''
      } ${arrastrando ? 'select-none' : ''}`}
      style={estilo}
      {...(asaCompleta ? asa : {})}
    >
      {!asaCompleta && flotante && (
        <span
          {...asa}
          title="Arrastra para mover este panel"
          className="pointer-events-auto absolute -left-2.5 top-3 z-10 rounded-md bg-slate-950/70 p-0.5 text-white/50 opacity-0 transition-opacity group-hover/arrastre:opacity-100"
        >
          <GripVertical className="size-4" aria-hidden />
        </span>
      )}
      {children}
    </div>
  );
}

/** Zoom y encuadre del mapa, con el estilo del tablero y no el de Leaflet. */
export function ControlesTablero({
  controles,
  movido,
  onReiniciar,
}: {
  controles: ControlesMapa | null;
  movido: boolean;
  onReiniciar: () => void;
}): ReactNode {
  if (!controles) return null;
  const boton =
    'flex size-9 items-center justify-center text-white/85 transition-colors hover:bg-white/15 hover:text-white';
  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <div className="vidrio flex overflow-hidden rounded-xl">
        <button type="button" onClick={controles.alejar} className={boton} title="Alejar">
          <ZoomOut className="size-4" aria-hidden />
          <span className="sr-only">Alejar</span>
        </button>
        <span className="w-px bg-white/15" aria-hidden />
        <button type="button" onClick={controles.acercar} className={boton} title="Acercar">
          <ZoomIn className="size-4" aria-hidden />
          <span className="sr-only">Acercar</span>
        </button>
        <span className="w-px bg-white/15" aria-hidden />
        <button
          type="button"
          onClick={controles.encuadrar}
          className={boton}
          title="Encuadrar todos los cercos"
        >
          <Locate className="size-4" aria-hidden />
          <span className="sr-only">Encuadrar todos los cercos</span>
        </button>
      </div>

      {movido && (
        <button
          type="button"
          onClick={onReiniciar}
          title="Devolver los paneles a su lugar"
          className="vidrio flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs text-white/85 transition-colors hover:bg-white/15 hover:text-white"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Ordenar paneles
        </button>
      )}
    </div>
  );
}

// ── Clima y alertas de faena ─────────────────────────────────────────────────

/** Punto cardinal desde el que sopla el viento, para leerlo sin grados. */
function rumbo(grados: number): string {
  const puntos = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return puntos[Math.round((((grados % 360) + 360) % 360) / 45) % 8] ?? 'N';
}

/** Color del índice UV según la escala de la OMS. */
function colorUV(uv: number): string {
  if (uv >= 11) return 'text-fuchsia-300';
  if (uv >= 8) return 'text-red-300';
  if (uv >= 6) return 'text-orange-300';
  if (uv >= 3) return 'text-yellow-300';
  return 'text-emerald-300';
}

export function PanelClima({ weather }: { weather: ObraWeather }): ReactNode {
  // Las críticas primero: si hay que suspender un izaje, eso se lee antes que
  // el recordatorio de bloqueador solar.
  const ordenadas = [
    ...weather.alerts.filter((a) => a.level === 'CRITICO'),
    ...weather.alerts.filter((a) => a.level === 'AVISO'),
  ];

  return (
    <div className="vidrio flex flex-col gap-1.5 rounded-xl px-3 py-2 lg:pointer-events-auto">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide 2xl:text-sm">
          <Thermometer className="size-3.5 opacity-80" aria-hidden />
          Condiciones en faena
        </h3>
        <span className="text-[11px] tabular-nums text-white/60 2xl:text-xs">
          {weather.observedAt.slice(11, 16)} h
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Dato
          valor={`${weather.temperature.toLocaleString('es-CL')}°`}
          etiqueta="Temperatura"
          Icon={Thermometer}
          pie={`ST ${weather.apparentTemperature.toLocaleString('es-CL')}°`}
        />
        <Dato
          valor={weather.windSpeed.toLocaleString('es-CL')}
          etiqueta={`Viento ${rumbo(weather.windDirection)}`}
          Icon={Wind}
          pie={`ráf. ${weather.windGusts.toLocaleString('es-CL')} km/h`}
        />
        <Dato
          valor={weather.uvIndex.toLocaleString('es-CL')}
          etiqueta="Índice UV"
          Icon={Sun}
          pie={`máx. hoy ${weather.uvIndexMax.toLocaleString('es-CL')}`}
          clase={colorUV(Math.max(weather.uvIndex, weather.uvIndexMax))}
        />
      </div>

      {ordenadas.length === 0 ? (
        <p className="text-[11px] leading-tight text-emerald-300/90 2xl:text-xs">
          Sin alertas: viento, UV y temperatura dentro de rango.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {ordenadas.map((a) => (
            <li
              key={a.key}
              className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-[11px] leading-tight 2xl:text-xs ${
                a.level === 'CRITICO'
                  ? 'bg-red-500/25 text-red-100 ring-1 ring-red-400/40'
                  : 'bg-amber-500/20 text-amber-100'
              }`}
            >
              <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
              {a.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dato({
  valor,
  etiqueta,
  pie,
  Icon,
  clase = 'text-white',
}: {
  valor: string;
  etiqueta: string;
  pie: string;
  Icon: typeof Thermometer;
  clase?: string;
}): ReactNode {
  return (
    <div className="min-w-0">
      <p
        className={`flex items-center gap-1 text-base font-bold leading-none tabular-nums 2xl:text-lg ${clase}`}
      >
        <Icon className="size-3.5 shrink-0 opacity-70 lg:size-4" aria-hidden />
        {valor}
      </p>
      <p className="mt-1 truncate text-[10px] uppercase tracking-wide text-white/55 2xl:text-xs">
        {etiqueta}
      </p>
      <p className="truncate text-[10px] text-white/70 2xl:text-xs">{pie}</p>
    </div>
  );
}

// ── Desplazamiento automático de los paneles ────────────────────────────────

/**
 * Recorre solo el contenido que no cabe en el panel.
 *
 * En la TV de faena nadie va a tomar el mouse: si una lista tiene doce filas y
 * se ven seis, las otras seis no existen. El panel baja solo, despacio, y
 * vuelve a subir. Se detiene mientras alguien tiene el cursor encima o mueve la
 * rueda, que es cuando el desplazamiento automático estorba en vez de ayudar, y
 * no arranca si el visor pidió menos movimiento.
 *
 * El reloj es un temporizador y no `requestAnimationFrame`: hay navegadores que
 * dejan de entregar cuadros cuando creen que la página no se está pintando
 * —paneles embebidos, modo kiosco— aunque `document.hidden` siga en `false`, y
 * ahí la pantalla se quedaría congelada justo donde más se la mira.
 *
 * Devuelve una ref de callback: los paneles se remontan en cada turno de la
 * rotación y hay que reenganchar el nodo nuevo, no el viejo.
 */
export function useDesplazadoAuto<T extends HTMLElement>(): (nodo: T | null) => void {
  const [nodo, setNodo] = useState<T | null>(null);

  useEffect(() => {
    if (!nodo) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Antes de arrancar se deja leer lo que está a la vista; en cada extremo se
    // hace una pausa para que la última fila no pase de largo.
    const ESPERA_INICIAL = 2_000;
    const ESPERA_EXTREMO = 1_800;
    const ESPERA_USUARIO = 2_500;
    // El recorrido completo dura esto, así que una lista corta baja más lento
    // que una larga y las dos alcanzan a mostrarse dentro de un turno.
    const RECORRIDO_MS = 9_000;
    const TIC_MS = 40;

    let sentido = 1;
    let pos = nodo.scrollTop;
    let reanudarEn = performance.now() + ESPERA_INICIAL;

    const tic = (): void => {
      const ahora = performance.now();
      const margen = nodo.scrollHeight - nodo.clientHeight;
      // Nada que recorrer: el panel entra completo y no hay que moverlo.
      if (margen <= 2) {
        pos = 0;
        return;
      }
      // Preguntar por `:hover` en cada tic y no llevar una bandera: si el panel
      // desaparece bajo el cursor, el `pointerleave` no llega y una bandera
      // dejaría el desplazamiento detenido para siempre.
      if (nodo.matches(':hover')) {
        pos = nodo.scrollTop;
        reanudarEn = ahora + ESPERA_USUARIO;
        return;
      }
      if (ahora < reanudarEn) {
        pos = nodo.scrollTop;
        return;
      }
      pos += sentido * (margen / RECORRIDO_MS) * TIC_MS;
      if (pos >= margen) {
        pos = margen;
        sentido = -1;
        reanudarEn = ahora + ESPERA_EXTREMO;
      } else if (pos <= 0) {
        pos = 0;
        sentido = 1;
        reanudarEn = ahora + ESPERA_EXTREMO;
      }
      nodo.scrollTop = pos;
    };

    const aparta = (): void => {
      reanudarEn = performance.now() + ESPERA_USUARIO;
    };

    nodo.addEventListener('wheel', aparta, { passive: true });
    nodo.addEventListener('touchstart', aparta, { passive: true });
    const reloj = window.setInterval(tic, TIC_MS);

    return () => {
      window.clearInterval(reloj);
      nodo.removeEventListener('wheel', aparta);
      nodo.removeEventListener('touchstart', aparta);
    };
  }, [nodo]);

  return setNodo;
}
