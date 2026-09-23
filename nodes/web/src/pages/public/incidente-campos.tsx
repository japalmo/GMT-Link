import { useEffect, useRef, useState, type ReactNode } from 'react';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  Loader2,
  MapPin,
} from 'lucide-react';

/**
 * Campos del reporte de incidente que el control nativo resuelve mal en terreno.
 *
 * El `input type="date"` y el `type="time"` del sistema abren un diálogo distinto
 * en cada teléfono, con letra chica y objetivos de toque de pocos milímetros.
 * Acá van tres piezas propias, pensadas para el pulgar: un calendario con atajos,
 * una rueda de hora y un mapa con el pin fijo al centro.
 */

// ── Fechas, siempre como texto aaaa-mm-dd ───────────────────────────────────

const DIAS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'] as const;
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** aaaa-mm-dd a sus partes, sin pasar por `Date` (que corre el día por zona). */
function partes(valor: string): { anio: number; mes: number; dia: number } {
  const [a, m, d] = valor.split('-').map(Number);
  return { anio: a ?? 2026, mes: (m ?? 1) - 1, dia: d ?? 1 };
}

function hoyIso(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "martes 23 de septiembre". Con el día de la semana, que es como se recuerda. */
function fechaLarga(valor: string): string {
  const { anio, mes, dia } = partes(valor);
  const d = new Date(anio, mes, dia);
  const semana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${semana[d.getDay()]} ${dia} de ${MESES[mes]}`;
}

/** Lunes = 0. El calendario chileno empieza la semana en lunes. */
function primerDiaSemana(anio: number, mes: number): number {
  return (new Date(anio, mes, 1).getDay() + 6) % 7;
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate();
}

export function SelectorFecha({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (v: string) => void;
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const [mesVisible, setMesVisible] = useState(() => {
    const { anio, mes } = partes(valor);
    return { anio, mes };
  });
  const hoy = hoyIso();

  const { anio, mes } = mesVisible;
  const huecos = primerDiaSemana(anio, mes);
  const total = diasDelMes(anio, mes);
  const esMesFuturo = iso(anio, mes, 1) > hoy;

  function elegir(dia: number): void {
    const elegido = iso(anio, mes, dia);
    if (elegido > hoy) return;
    onChange(elegido);
    setAbierto(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left transition active:scale-[0.99]"
      >
        <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          <span className="block text-[17px] font-medium capitalize leading-tight">
            {valor === hoy ? 'Hoy' : valor === hoyIso(-1) ? 'Ayer' : fechaLarga(valor)}
          </span>
          <span className="block text-[13px] text-muted-foreground">
            {valor === hoy || valor === hoyIso(-1) ? fechaLarga(valor) : partes(valor).anio}
          </span>
        </span>
        <ChevronRight
          className={`size-5 text-muted-foreground transition-transform ${abierto ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 duration-200 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none">
          <div className="flex gap-2">
            {[
              { label: 'Hoy', v: hoy },
              { label: 'Ayer', v: hoyIso(-1) },
              { label: 'Antes de ayer', v: hoyIso(-2) },
            ].map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  onChange(a.v);
                  setMesVisible(partes(a.v));
                  setAbierto(false);
                }}
                className={`h-9 flex-1 rounded-xl text-[14px] font-medium transition active:scale-[0.97] ${
                  valor === a.v ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Mes anterior"
              onClick={() =>
                setMesVisible(mes === 0 ? { anio: anio - 1, mes: 11 } : { anio, mes: mes - 1 })
              }
              className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition active:scale-[0.95] hover:bg-muted"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <span className="text-[15px] font-semibold capitalize">
              {MESES[mes]} {anio}
            </span>
            <button
              type="button"
              aria-label="Mes siguiente"
              disabled={esMesFuturo || iso(anio, mes, total) >= hoy}
              onClick={() =>
                setMesVisible(mes === 11 ? { anio: anio + 1, mes: 0 } : { anio, mes: mes + 1 })
              }
              className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition active:scale-[0.95] hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {DIAS.map((d) => (
              <span key={d} className="pb-1 text-[11px] font-medium uppercase text-muted-foreground">
                {d}
              </span>
            ))}
            {Array.from({ length: huecos }, (_, i) => (
              <span key={`hueco-${i}`} />
            ))}
            {Array.from({ length: total }, (_, i) => i + 1).map((dia) => {
              const fecha = iso(anio, mes, dia);
              const futuro = fecha > hoy;
              const elegido = fecha === valor;
              return (
                <button
                  key={dia}
                  type="button"
                  disabled={futuro}
                  onClick={() => elegir(dia)}
                  aria-current={elegido ? 'date' : undefined}
                  className={`flex aspect-square items-center justify-center rounded-xl text-[15px] tabular-nums transition active:scale-[0.94] ${
                    elegido
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : futuro
                        ? 'text-muted-foreground/30'
                        : fecha === hoy
                          ? 'bg-muted font-semibold'
                          : 'hover:bg-muted'
                  }`}
                >
                  {dia}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hora ────────────────────────────────────────────────────────────────────

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTOS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export function SelectorHora({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (v: string) => void;
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const [hh, mm] = valor.split(':');
  const colHora = useRef<HTMLDivElement>(null);
  const colMin = useRef<HTMLDivElement>(null);

  // Al abrir, cada columna muestra su valor actual: abrir en 00:00 obligaría a
  // desplazar a ciegas hasta la hora del incidente.
  useEffect(() => {
    if (!abierto) return;
    for (const col of [colHora.current, colMin.current]) {
      col?.querySelector('[data-elegido="true"]')?.scrollIntoView({ block: 'center' });
    }
  }, [abierto]);

  function ahora(): void {
    const d = new Date();
    const minuto = String(Math.round(d.getMinutes() / 5) * 5 === 60 ? 55 : Math.round(d.getMinutes() / 5) * 5).padStart(2, '0');
    onChange(`${String(d.getHours()).padStart(2, '0')}:${minuto}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left transition active:scale-[0.99]"
      >
        <Clock className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          <span className="block text-[17px] font-medium tabular-nums leading-tight">{valor}</span>
          <span className="block text-[13px] text-muted-foreground">Hora del incidente</span>
        </span>
        <ChevronRight
          className={`size-5 text-muted-foreground transition-transform ${abierto ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 duration-200 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none">
          <button
            type="button"
            onClick={() => {
              ahora();
              setAbierto(false);
            }}
            className="h-9 rounded-xl bg-muted text-[14px] font-medium transition active:scale-[0.98]"
          >
            Ahora mismo
          </button>
          <div className="relative grid grid-cols-2 gap-2">
            {/* Franja del centro: marca cuál es la fila elegida, como una rueda. */}
            <span
              className="pointer-events-none absolute inset-x-0 top-1/2 h-11 -translate-y-1/2 rounded-xl bg-primary/10"
              aria-hidden
            />
            <Columna
              ref={colHora}
              etiqueta="Hora"
              valores={HORAS}
              elegido={hh ?? '00'}
              onElegir={(v) => onChange(`${v}:${mm ?? '00'}`)}
            />
            <Columna
              ref={colMin}
              etiqueta="Minutos"
              valores={MINUTOS}
              elegido={mm ?? '00'}
              onElegir={(v) => onChange(`${hh ?? '00'}:${v}`)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Columna({
  ref,
  etiqueta,
  valores,
  elegido,
  onElegir,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  etiqueta: string;
  valores: readonly string[];
  elegido: string;
  onElegir: (v: string) => void;
}): ReactNode {
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={etiqueta}
      className="h-44 snap-y snap-mandatory overflow-y-auto scroll-py-16 py-16 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {valores.map((v) => (
        <button
          key={v}
          type="button"
          role="option"
          aria-selected={v === elegido}
          data-elegido={v === elegido}
          onClick={() => onElegir(v)}
          className={`flex h-11 w-full snap-center items-center justify-center rounded-xl text-[20px] tabular-nums transition ${
            v === elegido ? 'font-semibold text-foreground' : 'text-muted-foreground'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ── Mapa del área ───────────────────────────────────────────────────────────

/** Centro por defecto: Antofagasta, donde está la casa matriz. */
const CENTRO: [number, number] = [-23.6509, -70.3975];

/**
 * Mosaicos de OpenStreetMap, teñidos de gris por CSS (clase `mapa-sobrio`).
 *
 * Se hace con un filtro y no con un proveedor de mapas "claro" porque los
 * gratuitos de ese estilo hoy piden llave y estampan una marca de agua sobre el
 * mapa. Así el estilo acompaña a GMT Link sin depender de nadie más.
 */
const MOSAICOS = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUCION = '&copy; OpenStreetMap';

/** Una sugerencia del buscador de direcciones. */
interface Sugerencia {
  nombre: string;
  lat: number;
  lng: number;
}

async function direccionDe(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=es`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? null;
}

/**
 * Busca direcciones. `vista` es el recuadro que el mapa está mostrando y se
 * manda como sesgo (no como filtro): sin él, "Avenida Brasil" trae la de
 * cualquier ciudad del país antes que la que se tiene en pantalla.
 */
async function buscarDirecciones(
  texto: string,
  signal: AbortSignal,
  vista?: string,
): Promise<Sugerencia[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=cl' +
    `&accept-language=es&q=${encodeURIComponent(texto)}` +
    (vista ? `&viewbox=${vista}&bounded=0` : '');
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  return data.map((d) => ({ nombre: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
}

/**
 * Mapa para ubicar el incidente.
 *
 * El pin va FIJO en el centro y lo que se mueve es el mapa, como en las apps de
 * mapas del teléfono: con una mano, arrastrar el fondo es mucho más fácil que
 * acertarle a un marcador de pocos milímetros.
 *
 * La dirección se consulta al TERMINAR el movimiento, nunca durante: es lo que
 * pide la política de uso de OpenStreetMap y además evita que el campo parpadee
 * mientras se arrastra.
 */
export function MapaArea({
  area,
  onArea,
  coords,
  onCoords,
}: {
  area: string;
  onArea: (v: string) => void;
  coords: { lat: number; lng: number } | null;
  onCoords: (c: { lat: number; lng: number }) => void;
}): ReactNode {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [moviendo, setMoviendo] = useState(false);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [escribiendo, setEscribiendo] = useState(false);

  // Los callbacks se leen desde un ref: el mapa se arma una sola vez y no debe
  // rearmarse porque el formulario haya cambiado de estado.
  const acciones = useRef({ onArea, onCoords });
  acciones.current = { onArea, onCoords };
  /**
   * Cuando el mapa se mueve porque se eligió una sugerencia, la dirección ya la
   * sabemos: sin esta marca, la consulta inversa la pisaría con el nombre que
   * OpenStreetMap le da al punto, casi siempre más largo y menos reconocible.
   */
  const direccionFijada = useRef(false);
  const abortar = useRef<AbortController | null>(null);

  useEffect(() => {
    let vivo = true;
    let mapaLocal: L.Map | null = null;

    void (async () => {
      const Lmod = (await import('leaflet')).default;
      if (!vivo || !contenedor.current || mapa.current) return;

      const inicio: [number, number] = coords ? [coords.lat, coords.lng] : CENTRO;
      mapaLocal = Lmod.map(contenedor.current, {
        center: inicio,
        zoom: coords ? 17 : 13,
        zoomControl: false,
        attributionControl: true,
      });
      mapa.current = mapaLocal;

      Lmod.tileLayer(MOSAICOS, { attribution: ATRIBUCION, maxZoom: 19 }).addTo(mapaLocal);

      mapaLocal.on('movestart', () => setMoviendo(true));
      mapaLocal.on('moveend', () => {
        setMoviendo(false);
        const c = mapaLocal?.getCenter();
        if (!c) return;
        acciones.current.onCoords({ lat: c.lat, lng: c.lng });
        if (direccionFijada.current) {
          direccionFijada.current = false;
          return;
        }
        abortar.current?.abort();
        const control = new AbortController();
        abortar.current = control;
        setBuscando(true);
        setNota(null);
        void direccionDe(c.lat, c.lng, control.signal)
          .then((direccion) => {
            if (control.signal.aborted) return;
            if (direccion) acciones.current.onArea(direccion);
            else setNota('No encontramos una dirección para ese punto. Escríbela a mano.');
          })
          .catch(() => {
            if (!control.signal.aborted) {
              setNota('No se pudo consultar la dirección. Escríbela a mano.');
            }
          })
          .finally(() => {
            if (!control.signal.aborted) setBuscando(false);
          });
      });

      // El contenedor nace dentro de un paso oculto: sin esto, los mosaicos
      // quedan a medio dibujar hasta que alguien toca el mapa.
      setTimeout(() => mapaLocal?.invalidateSize(), 60);
    })();

    return () => {
      vivo = false;
      abortar.current?.abort();
      mapaLocal?.remove();
      mapa.current = null;
    };
    // Se arma una sola vez: las coordenadas iniciales se leen al montar y los
    // callbacks viven en `acciones`, así que no hay nada más que observar.
  }, []);

  // Sugerencias mientras se escribe, con demora y desde 3 letras: una consulta
  // por tecla contra un servicio gratuito termina bloqueada.
  useEffect(() => {
    if (!escribiendo || area.trim().length < 3) {
      setSugerencias([]);
      return;
    }
    const control = new AbortController();
    const t = setTimeout(() => {
      void buscarDirecciones(area.trim(), control.signal, recuadroVisible())
        .then((r) => setSugerencias(r))
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(t);
      control.abort();
    };
  }, [area, escribiendo]);

  /** El recuadro que muestra el mapa, en el orden que pide Nominatim. */
  function recuadroVisible(): string | undefined {
    const b = mapa.current?.getBounds();
    if (!b) return undefined;
    return [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()]
      .map((v) => v.toFixed(5))
      .join(',');
  }

  function elegirSugerencia(s: Sugerencia): void {
    direccionFijada.current = true;
    onArea(s.nombre);
    setSugerencias([]);
    setEscribiendo(false);
    onCoords({ lat: s.lat, lng: s.lng });
    mapa.current?.setView([s.lat, s.lng], 17);
  }

  function miUbicacion(): void {
    if (!navigator.geolocation) {
      setNota('Este teléfono no permite compartir la ubicación.');
      return;
    }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUbicando(false);
        mapa.current?.setView([pos.coords.latitude, pos.coords.longitude], 17);
      },
      () => {
        setUbicando(false);
        setNota('No pudimos obtener tu ubicación. Mueve el mapa a mano.');
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mapa-sobrio relative overflow-hidden rounded-2xl border border-border">
        <div
          ref={contenedor}
          role="application"
          aria-label="Mapa para ubicar el incidente: mueve el mapa y el pin del centro marca el lugar"
          className="h-56 w-full [&_.leaflet-container]:bg-muted [&_.leaflet-control-attribution]:bg-background/70 [&_.leaflet-control-attribution]:text-[9px]"
        />

        {/* Pin fijo al centro: el mapa se mueve por debajo. */}
        <div
          className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center"
          aria-hidden
        >
          <div
            className={`-mt-5 flex flex-col items-center gap-0.5 transition-transform duration-200 ${
              moviendo ? '-translate-y-1.5' : ''
            }`}
          >
            <MapPin className="size-9 fill-primary text-primary drop-shadow-md" strokeWidth={1.5} />
            <span
              className={`size-2 rounded-full bg-primary/30 transition-transform ${
                moviendo ? 'scale-150' : ''
              }`}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={miUbicacion}
          disabled={ubicando}
          className="absolute right-3 top-3 z-[500] flex size-11 items-center justify-center rounded-full border border-border bg-background/90 shadow-sm backdrop-blur transition active:scale-[0.95]"
          aria-label="Centrar en mi ubicación"
        >
          {ubicando ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Crosshair className="size-5" aria-hidden />
          )}
        </button>
      </div>

      <div className="relative">
        <input
          className="h-12 w-full rounded-2xl border border-border bg-card px-4 text-[16px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
          value={area}
          onChange={(e) => {
            setEscribiendo(true);
            onArea(e.target.value);
          }}
          onFocus={() => setEscribiendo(true)}
          placeholder="Escribe la dirección o mueve el mapa"
          autoComplete="off"
          aria-label="Área o lugar exacto"
          aria-expanded={sugerencias.length > 0}
        />
        {sugerencias.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-[600] mt-1 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
            {sugerencias.map((s) => (
              <li key={`${s.lat},${s.lng}`}>
                <button
                  type="button"
                  onClick={() => elegirSugerencia(s)}
                  className="flex w-full items-start gap-2 px-4 py-3 text-left text-[14px] leading-snug transition hover:bg-muted active:bg-muted"
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="line-clamp-2">{s.nombre}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {buscando && <Loader2 className="size-3 animate-spin" aria-hidden />}
        {nota ??
          (buscando
            ? 'Buscando la dirección…'
            : coords
              ? `Pin en ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
              : 'Mueve el mapa hasta que el pin quede donde ocurrió.')}
      </p>
    </div>
  );
}
