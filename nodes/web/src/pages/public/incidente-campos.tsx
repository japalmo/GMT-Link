import { useEffect, useRef, useState, type ReactNode } from 'react';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Crosshair, Loader2 } from 'lucide-react';

/**
 * Campos del reporte de incidente que el control nativo resuelve mal en terreno.
 *
 * El `input type="date"` y el `type="time"` del sistema abren un diálogo distinto
 * en cada teléfono, con letra chica y objetivos de toque de pocos milímetros.
 * Acá van tres piezas propias, pensadas para el pulgar: un calendario con atajos,
 * una rueda de hora y un mapa donde se arrastra el pin.
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
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z"/><circle cx="12" cy="9" r="2.6" fill="white"/></svg>';

async function direccionDe(lat: number, lon: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=es`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? null;
}

/**
 * Mapa para ubicar el incidente: se arrastra el pin o se toca el mapa, y la
 * dirección se completa sola. La dirección se consulta SOLO al soltar el pin,
 * nunca mientras se arrastra, que es lo que pide la política de uso de
 * OpenStreetMap y además evita parpadeos en el campo.
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
  const pin = useRef<L.Marker | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  // Los callbacks se leen desde un ref: el mapa se arma una sola vez y no debe
  // rearmarse porque el formulario haya cambiado de estado.
  const acciones = useRef({ onArea, onCoords });
  acciones.current = { onArea, onCoords };

  useEffect(() => {
    let vivo = true;
    let mapaLocal: L.Map | null = null;

    void (async () => {
      const Lmod = (await import('leaflet')).default;
      if (!vivo || !contenedor.current || mapa.current) return;

      const inicio: [number, number] = coords ? [coords.lat, coords.lng] : CENTRO;
      mapaLocal = Lmod.map(contenedor.current, {
        center: inicio,
        zoom: coords ? 16 : 12,
        zoomControl: false,
        attributionControl: true,
      });
      mapa.current = mapaLocal;
      Lmod.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(mapaLocal);

      const marcador = Lmod.marker(inicio, {
        draggable: true,
        icon: Lmod.divIcon({
          className: 'hse-pin',
          html: `<div class="text-primary drop-shadow">${PIN_SVG}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 32],
        }),
      }).addTo(mapaLocal);
      pin.current = marcador;

      async function mover(lat: number, lng: number): Promise<void> {
        marcador.setLatLng([lat, lng]);
        acciones.current.onCoords({ lat, lng });
        setBuscando(true);
        setNota(null);
        try {
          const direccion = await direccionDe(lat, lng);
          if (direccion) acciones.current.onArea(direccion);
          else setNota('No encontramos una dirección para ese punto. Escríbela a mano.');
        } catch {
          setNota('No se pudo consultar la dirección. Escríbela a mano.');
        } finally {
          setBuscando(false);
        }
      }

      marcador.on('dragend', () => {
        const ll = marcador.getLatLng();
        void mover(ll.lat, ll.lng);
      });
      mapaLocal.on('click', (e: L.LeafletMouseEvent) => void mover(e.latlng.lat, e.latlng.lng));
      // El contenedor nace dentro de un paso oculto: sin esto, los mosaicos
      // quedan a medio dibujar hasta que alguien toca el mapa.
      setTimeout(() => mapaLocal?.invalidateSize(), 60);
    })();

    return () => {
      vivo = false;
      mapaLocal?.remove();
      mapa.current = null;
      pin.current = null;
    };
    // Se arma una sola vez: las coordenadas iniciales se leen al montar y los
    // callbacks viven en `acciones`, así que no hay nada más que observar.
  }, []);

  function miUbicacion(): void {
    if (!navigator.geolocation) {
      setNota('Este teléfono no permite compartir la ubicación.');
      return;
    }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUbicando(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        mapa.current?.setView([lat, lng], 17);
        pin.current?.setLatLng([lat, lng]);
        pin.current?.fire('dragend');
      },
      () => {
        setUbicando(false);
        setNota('No pudimos obtener tu ubicación. Mueve el pin a mano.');
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl border border-border">
        <div
          ref={contenedor}
          role="application"
          aria-label="Mapa para ubicar el incidente"
          className="h-56 w-full [&_.leaflet-control-attribution]:text-[9px]"
        />
        <button
          type="button"
          onClick={miUbicacion}
          disabled={ubicando}
          className="absolute right-3 top-3 z-[500] flex size-11 items-center justify-center rounded-full bg-background/90 shadow-md backdrop-blur transition active:scale-[0.95]"
          aria-label="Centrar en mi ubicación"
        >
          {ubicando ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Crosshair className="size-5" aria-hidden />
          )}
        </button>
      </div>

      <input
        className="h-12 w-full rounded-2xl border border-border bg-card px-4 text-[16px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
        value={area}
        onChange={(e) => onArea(e.target.value)}
        placeholder="Arrastra el pin o escribe el lugar"
        autoComplete="off"
        aria-label="Área o lugar exacto"
      />
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {buscando && <Loader2 className="size-3 animate-spin" aria-hidden />}
        {nota ??
          (buscando
            ? 'Buscando la dirección…'
            : coords
              ? `Pin en ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
              : 'Arrastra el pin hasta donde ocurrió, o toca el mapa.')}
      </p>
    </div>
  );
}
