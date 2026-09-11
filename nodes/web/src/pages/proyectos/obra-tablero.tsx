import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  CalendarClock,
  Flag,
  Layers,
  MapPin,
  Minus,
  Pin,
  PinOff,
  Table2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  ObraBreakdown,
  ObraControl,
  ObraCurvePoint,
  ObraDashboard,
  ObraLine,
  ObraMapPoint,
  ObraMilestone,
  ObraRecentReport,
  ObraStatus,
} from '@gmt-platform/contracts';
import {
  COLOR_ESTADO,
  NOMBRE_ESTADO,
  ObraMapa,
  SIN_FILTRO,
  pasaFiltro,
  type ControlesMapa,
  type FiltroMapa,
} from './obra-mapa';
import {
  COLOR_PLAN,
  COLOR_REAL,
  CurvaControl,
  FasesControl,
  NavegadorSemana,
  TablaControl,
} from './obra-curva';
import { useDisposicion } from './usar-arrastre';
import {
  Arrastrable,
  ControlesTablero,
  PanelClima,
  useDesplazadoAuto,
} from './obra-piezas';

/**
 * Tablero de avance de obra: el mapa satelital de la faena es el FONDO y todo
 * lo demás flota encima en vidrio. Entra completo en una pantalla de TV y de
 * notebook; en móvil se apila, porque comprimirlo ahí dejaría los números
 * ilegibles.
 *
 * Hay dos clases de panel y la diferencia es deliberada:
 *
 * - Los FIJOS no se ocultan nunca, porque son los que se miran en una reunión
 *   de obra: los cinco indicadores de arriba, las condiciones de faena y la
 *   curva S del control por HH, que es el informe que se le entrega al cliente.
 * - Los que ROTAN son el detalle. Cualquiera se puede fijar para quedarse en él.
 *
 * Todo el tablero cuelga de una SEMANA del control. Retroceder muestra los
 * cortes ya informados; avanzar muestra lo que el programa proyecta, y el
 * rótulo dice siempre cuál de las dos cosas se está viendo.
 */

// Cada dupla se queda este tiempo. 13 s alcanza para leerla sin que quien pasa
// frente a la TV espere demasiado por la que le importa.
const TURNO_MS = 13_000;

// ── Formato ──────────────────────────────────────────────────────────────────

/**
 * Fecha ISO (aaaa-mm-dd) a dd-mm-aaaa SIN pasar por `Date`: construir un Date
 * con "2026-09-10" lo interpreta como medianoche UTC y en Chile mostraría el 9.
 */
export function fechaLarga(iso: string | null): string {
  if (!iso) return 'Sin fecha';
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}-${m}-${a}` : iso;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  if (!a || !m || !d) return iso;
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

function cantidad(n: number): string {
  return n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
}

function porcentaje(n: number): string {
  return n.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Semáforo sobre vidrio oscuro: los tonos del tema no contrastan ahí. */
const ESTADO: Record<
  ObraStatus,
  { label: string; clase: string; punto: string; Icon: typeof TrendingUp }
> = {
  ADELANTADO: { label: 'Adelantado', clase: 'text-emerald-300', punto: 'bg-emerald-400', Icon: TrendingUp },
  EN_LINEA: { label: 'En línea', clase: 'text-sky-300', punto: 'bg-sky-400', Icon: Minus },
  LEVE_ATRASO: { label: 'Leve atraso', clase: 'text-amber-300', punto: 'bg-amber-400', Icon: TrendingDown },
  ATRASADO: { label: 'Atrasado', clase: 'text-rose-300', punto: 'bg-rose-400', Icon: TrendingDown },
};

function semaforoDe(desviacion: number): ObraStatus {
  if (desviacion >= 1) return 'ADELANTADO';
  if (desviacion >= -1) return 'EN_LINEA';
  if (desviacion >= -5) return 'LEVE_ATRASO';
  return 'ATRASADO';
}

// ── Animación ────────────────────────────────────────────────────────────────

/** Sigue una media query y se vuelve a evaluar cuando cambia. */
function usaConsulta(consulta: string): boolean {
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    setActiva(mq.matches);
    const cambio = (e: MediaQueryListEvent) => setActiva(e.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, [consulta]);
  return activa;
}

/** ¿El visor pidió menos movimiento? Entonces nada se anima, solo aparece. */
function usaMenosMovimiento(): boolean {
  return usaConsulta('(prefers-reduced-motion: reduce)');
}

/**
 * Número que sube hasta su valor. Da sensación de dato vivo y hace evidente
 * que la cifra cambió cuando la pantalla se refresca sola.
 */
function useConteo(valor: number, activo: boolean): number {
  const [mostrado, setMostrado] = useState(activo ? 0 : valor);
  const anterior = useRef(activo ? 0 : valor);

  useEffect(() => {
    // `requestAnimationFrame` no corre en una pestaña oculta: sin esta salida,
    // una TV que arranca en segundo plano se quedaría mostrando 0%. El dato
    // correcto manda sobre la animación.
    if (!activo || document.hidden) {
      setMostrado(valor);
      anterior.current = valor;
      return;
    }
    const desde = anterior.current;
    const inicio = performance.now();
    const DURACION = 900;
    let frame = 0;
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / DURACION);
      const suave = 1 - (1 - t) ** 3;
      setMostrado(desde + (valor - desde) * suave);
      if (t < 1) frame = requestAnimationFrame(paso);
      else anterior.current = valor;
    };
    frame = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(frame);
  }, [valor, activo]);

  return mostrado;
}

// ── La semana elegida, aplicada a la obra ────────────────────────────────────

/** Lo que el tablero sabe de la semana que se está mirando. */
interface Corte {
  control: ObraControl;
  semana: number;
  /** ¿Esa semana ya tiene informe, o es proyección del programa? */
  informada: boolean;
  cierre: string;
  etiqueta: string;
  realPercent: number | null;
  planPercent: number;
  deviation: number | null;
}

function cortarEn(control: ObraControl, semana: number): Corte | null {
  const w = control.weeks[semana];
  if (!w) return null;
  const informada = semana <= control.lastClosed;
  // En el último corte informado manda la cabecera del informe y no la semana:
  // el corte cae a media semana y el plan del documento va prorrateado por día.
  const enElCorte = informada && semana === control.lastClosed;
  return {
    control,
    semana,
    informada,
    cierre: w.closeDate,
    etiqueta: informada
      ? `Informado al cierre ${w.code}`
      : `Proyección del programa al cierre ${w.code}`,
    realPercent: enElCorte ? control.realPercent : w.acmReal,
    planPercent: enElCorte ? control.planPercent : w.acmPlan,
    deviation: enElCorte ? control.deviation : w.deviation,
  };
}

/**
 * Los cercos del mapa, llevados a la semana elegida. Hacia atrás se dibuja lo
 * ejecutado; hacia adelante, lo que el programa espera para esa fecha. Sin
 * control semanal se devuelven tal cual: el estado de hoy es lo único que hay.
 */
function puntosEn(puntos: ObraMapPoint[], corte: Corte | null): ObraMapPoint[] {
  if (!corte) return puntos;
  return puntos.map((p) => {
    const serie = corte.informada ? p.realByWeek : p.planByWeek;
    const valor = serie[corte.semana];
    if (valor === undefined) return p;
    const avance = Math.round(valor * 10) / 10;
    const status =
      avance >= 99.95 ? 'TERMINADO' : avance > 0 ? 'EN_EJECUCION' : 'PENDIENTE';
    return {
      ...p,
      percent: avance,
      status,
      // Las etapas terminadas se estiman desde el avance: en una semana pasada
      // no se guarda cuántas había cerradas, y el porcentaje sí es exacto.
      stepsDone: Math.round((avance / 100) * p.stepsTotal),
      // La etapa en curso solo se conoce hoy. Inventarla para otra semana sería
      // afirmar algo que el dato no dice.
      currentStep: corte.semana === corte.control.lastClosed ? p.currentStep : null,
    };
  });
}

// ── Tablero ──────────────────────────────────────────────────────────────────

export function ObraTablero({
  data,
  fijo = true,
}: {
  data: ObraDashboard;
  /** `true` ocupa el alto que le den (TV). `false` usa un alto propio. */
  fijo?: boolean;
}): ReactNode {
  const quieto = usaMenosMovimiento();
  const [filtro, setFiltro] = useState<FiltroMapa>(SIN_FILTRO);
  const [controles, setControles] = useState<ControlesMapa | null>(null);
  // La disposición se guarda por proyecto: mover los paneles de una obra no
  // debe descolocar los de la siguiente.
  const { posiciones, mover, reiniciar, movido } = useDisposicion(data.projectId);

  const control = data.control;
  const arranque = control ? Math.max(0, control.lastClosed) : 0;
  const [semana, setSemana] = useState(arranque);
  // Al cambiar de obra o al llegar un corte nuevo, el tablero vuelve al último
  // informe: es lo que hay que mirar, no donde quedó el navegador.
  useEffect(() => setSemana(arranque), [data.projectId, control?.cutoff, arranque]);

  const corte = useMemo(
    () => (control ? cortarEn(control, semana) : null),
    [control, semana],
  );
  const puntos = useMemo(() => puntosEn(data.map.points, corte), [data.map.points, corte]);
  // Identidades estables: el mapa reencuadra cada vez que cambian, así que un
  // objeto nuevo por render lo dejaría reencuadrando para siempre.
  const mapaSemana = useMemo(
    () => ({ points: puntos, unlocated: data.map.unlocated }),
    [puntos, data.map.unlocated],
  );
  const corteMapa = useMemo(
    () => (corte ? { etiqueta: corte.etiqueta, hasta: corte.cierre } : undefined),
    [corte],
  );

  // Con la curva fija abajo, un notebook de 768 px de alto deja 185 px para
  // las tarjetas: dos ahí son dos encabezados sin contenido. Desde 900 px sí
  // caben las dos, que es lo que se ve en la TV de faena.
  const dosTarjetas = usaConsulta('(min-height: 900px)');
  const paneles = useMemo(
    () => construirPaneles(data, puntos, corte, semana, setSemana),
    [data, puntos, corte, semana],
  );
  const duplas = useMemo(
    () => emparejar(paneles, dosTarjetas ? 2 : 1),
    [paneles, dosTarjetas],
  );
  const [turno, setTurno] = useState(0);
  const [fijada, setFijada] = useState<number | null>(null);

  useEffect(() => {
    setTurno(0);
    setFijada(null);
  }, [duplas.length]);

  useEffect(() => {
    if (duplas.length < 2 || fijada !== null) return;
    const id = window.setInterval(() => setTurno((t) => (t + 1) % duplas.length), TURNO_MS);
    return () => window.clearInterval(id);
  }, [duplas.length, fijada]);

  const indice = fijada ?? Math.min(turno, duplas.length - 1);
  const actual = duplas[indice] ?? [];
  const hayFiltro = filtro.estados.length > 0 || filtro.tipos.length > 0 || filtro.sector !== null;
  const visibles = puntos.filter((p) => pasaFiltro(p, filtro)).length;
  const conMapa = puntos.length > 0;

  const irA = (i: number) => {
    setTurno(i);
    if (fijada !== null) setFijada(i);
  };

  const tarjetas = actual.map((panel) => (
    <TarjetaPanel
      key={panel.id}
      panel={panel}
      quieto={quieto}
      total={duplas.length}
      indice={indice}
      fijada={fijada !== null}
      onIr={irA}
      onFijar={() => setFijada((f) => (f === null ? indice : null))}
    />
  ));

  /*
   * Dos layouts, no uno con parches. De `lg` para arriba el mapa es el fondo y
   * el resto flota encima: es la vista de TV. Más abajo se apila en orden
   * normal, porque en una pantalla angosta el vidrio flotante se encabalga y
   * queda ilegible.
   */
  return (
    <div
      className={`flex flex-col gap-2 lg:relative lg:isolate lg:gap-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-white/10 lg:bg-slate-900 ${
        fijo ? 'lg:h-full lg:min-h-[600px]' : 'lg:h-[82vh]'
      }`}
    >
      {conMapa && (
        <div className="relative h-[280px] shrink-0 overflow-hidden rounded-xl border border-white/10 sm:h-[340px] lg:absolute lg:inset-0 lg:h-auto lg:rounded-none lg:border-0">
          <ObraMapa
            mapa={mapaSemana}
            filtro={filtro}
            corte={corteMapa}
            onControles={setControles}
          />
          {/* Velo: el terreno de Mantos Blancos es arena clara y el vidrio
              necesita fondo para que el texto blanco se lea también sobre las
              zonas planas. */}
          <div
            className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-br from-slate-950/50 via-slate-950/15 to-slate-950/50"
            aria-hidden
          />
        </div>
      )}

      {/* Capa de contenido. Sobre el mapa no captura el puntero salvo en las
          tarjetas, para que el mapa se arrastre por los huecos. */}
      <div className="flex flex-col gap-2 sm:gap-3 lg:pointer-events-none lg:absolute lg:inset-0 lg:z-20 lg:p-3">
        <Arrastrable id="indicadores" posiciones={posiciones} onMover={mover} asaCompleta>
          <div className="flex flex-col gap-1.5">
            {control && corte && (
              <BarraCorte
                control={control}
                corte={corte}
                semana={semana}
                onSemana={setSemana}
              />
            )}
            <Indicadores data={data} corte={corte} quieto={quieto} />
          </div>
        </Arrastrable>

        <div className="flex flex-col gap-2 sm:gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
          <div className="order-2 flex flex-col gap-2 sm:gap-3 lg:order-1 lg:w-[260px] lg:shrink-0 lg:justify-start lg:overflow-y-auto lg:pr-1 desplazable">
            {data.weather && (
              <Arrastrable id="clima" posiciones={posiciones} onMover={mover}>
                <PanelClima weather={data.weather} />
              </Arrastrable>
            )}
          </div>

          {/* Hueco por el que se ve el mapa; abajo van los controles del mapa.
              Lleva `order` propio: sin él se colaba antes de la columna de la
              izquierda y todos los paneles terminaban apilados a la derecha. */}
          <div className="flex min-w-0 flex-col items-center justify-end gap-2 lg:order-2 lg:flex-1">
            {conMapa && (
              <ControlesTablero
                controles={controles}
                movido={movido}
                onReiniciar={reiniciar}
              />
            )}
            {conMapa && (
              <Arrastrable id="leyenda" posiciones={posiciones} onMover={mover}>
                <LeyendaFiltros
                  puntos={puntos}
                  visibles={visibles}
                  sinUbicar={data.map.unlocated}
                  filtro={filtro}
                  onFiltro={setFiltro}
                  hayFiltro={hayFiltro}
                  proyectado={corte !== null && !corte.informada}
                />
              </Arrastrable>
            )}
          </div>

          <div className="order-1 flex flex-col gap-2 sm:gap-3 lg:order-3 lg:min-h-0 lg:w-[420px] lg:flex-none lg:overflow-hidden">
            <Arrastrable id="tarjetas" posiciones={posiciones} onMover={mover} columna>
              {tarjetas}
            </Arrastrable>
          </div>
        </div>

        {/* La curva manda: va fija abajo, a todo el ancho, y no rota nunca. */}
        <Arrastrable id="curva" posiciones={posiciones} onMover={mover}>
          <PanelFijo
            titulo={
              control ? 'Avance semanal y curva S · control por HH' : 'Curva S de avance físico'
            }
            Icon={Activity}
            alto="h-[230px] sm:h-[250px] lg:h-[28vh] lg:max-h-[300px] lg:min-h-[176px]"
            extra={
              control ? (
                <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-white/60 lg:flex 2xl:text-xs">
                  <Table2 className="size-3.5 opacity-70" aria-hidden />
                  {cantidad(control.totalHh)} HH · corte {fechaLarga(control.cutoff)}
                </span>
              ) : null
            }
          >
            {control ? (
              <CurvaControl
                control={control}
                semana={semana}
                onSemana={setSemana}
                quieto={quieto}
              />
            ) : (
              <CurvaS curves={data.curves} />
            )}
          </PanelFijo>
        </Arrastrable>
      </div>
    </div>
  );
}

// ── Barra del corte ──────────────────────────────────────────────────────────

/** La fecha del tablero, con las flechas que la mueven en el tiempo. */
function BarraCorte({
  control,
  corte,
  semana,
  onSemana,
}: {
  control: ObraControl;
  corte: Corte;
  semana: number;
  onSemana: (i: number) => void;
}): ReactNode {
  return (
    <div className="vidrio pointer-events-auto flex items-center justify-between gap-3 rounded-xl px-3 py-1">
      <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] uppercase tracking-wide text-white/60 2xl:text-xs">
        <CalendarClock className="size-3.5 shrink-0 opacity-75" aria-hidden />
        {corte.etiqueta}
      </span>
      <NavegadorSemana control={control} semana={semana} onSemana={onSemana} />
    </div>
  );
}

// ── Marco de un panel que no rota ────────────────────────────────────────────

function PanelFijo({
  titulo,
  Icon,
  alto,
  extra,
  children,
}: {
  titulo: string;
  Icon: typeof Activity;
  alto: string;
  extra?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section
      className={`vidrio flex shrink-0 flex-col overflow-hidden rounded-xl lg:pointer-events-auto ${alto}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-1.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold 2xl:text-base">
          <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
          <span className="truncate">{titulo}</span>
        </h2>
        {extra}
      </header>
      <div className="min-h-0 flex-1 px-3 py-2">{children}</div>
    </section>
  );
}

/** Una tarjeta de vidrio con su panel adentro. */
function TarjetaPanel({
  panel,
  quieto,
  total,
  indice,
  fijada,
  onIr,
  onFijar,
}: {
  panel: Panel;
  quieto: boolean;
  total: number;
  indice: number;
  fijada: boolean;
  onIr: (i: number) => void;
  onFijar: () => void;
}): ReactNode {
  return (
    <section className="vidrio flex h-[210px] flex-col overflow-hidden rounded-xl lg:pointer-events-auto lg:h-auto lg:min-h-[124px] lg:flex-1">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-1.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold 2xl:text-base">
          <panel.Icon className="size-4 shrink-0 opacity-80" aria-hidden />
          <span className="truncate">{panel.titulo}</span>
          {panel.aHoy && (
            <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-white/70">
              a hoy
            </span>
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <Turnos total={total} activo={indice} quieto={quieto} corriendo={!fijada} onIr={onIr} />
          <button
            type="button"
            onClick={onFijar}
            aria-pressed={fijada}
            title={fijada ? 'Volver a rotar' : 'Fijar esta vista'}
            className={`rounded-md p-1 transition-colors ${
              fijada ? 'bg-white text-slate-900' : 'text-white/70 hover:bg-white/15 hover:text-white'
            }`}
          >
            {fijada ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            <span className="sr-only">{fijada ? 'Volver a rotar' : 'Fijar esta vista'}</span>
          </button>
        </div>
      </header>

      {/* La `key` fuerza el remontaje: cada panel entra animándose. */}
      <div key={panel.id} className={`min-h-0 flex-1 px-3 py-2 ${quieto ? '' : 'animate-panel'}`}>
        {panel.contenido}
      </div>
    </section>
  );
}

/** Puntos de la rotación. Se pueden tocar para saltar a una dupla. */
function Turnos({
  total,
  activo,
  quieto,
  corriendo,
  onIr,
}: {
  total: number;
  activo: number;
  quieto: boolean;
  corriendo: boolean;
  onIr: (i: number) => void;
}): ReactNode {
  if (total < 2) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onIr(i)}
          aria-label={`Ver panel ${i + 1} de ${total}`}
          aria-current={i === activo}
          className={`h-1.5 overflow-hidden rounded-full transition-all ${
            i === activo ? 'w-7 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'
          }`}
        >
          {i === activo && !quieto && corriendo && (
            <span className="block h-full w-full origin-left animate-turno rounded-full bg-white/50" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Fila de indicadores ──────────────────────────────────────────────────────

/**
 * Los cinco que nunca se ocultan. Cuando hay control por HH mandan sus cifras,
 * que son las del informe al cliente; si la obra no tiene programa cargado, se
 * muestra el avance físico, que es lo único que hay.
 */
function Indicadores({
  data,
  corte,
  quieto,
}: {
  data: ObraDashboard;
  corte: Corte | null;
  quieto: boolean;
}): ReactNode {
  const real = corte ? corte.realPercent : data.realProgress;
  const plan = corte ? corte.planPercent : data.plannedProgress;
  const desviacion = corte ? corte.deviation : data.deviation;
  const est = ESTADO[desviacion === null ? data.status : semaforoDe(desviacion)];
  const proyectado = corte !== null && !corte.informada;
  // HH del contrato llevadas al avance que se está mirando. Es la segunda cifra
  // de cabecera del informe y la que traduce el porcentaje a algo tangible.
  const hh = corte
    ? {
        hechas: Math.round((corte.control.totalHh * ((real ?? plan) / 100)) * 10) / 10,
        totales: corte.control.totalHh,
      }
    : null;

  return (
    <div className="pointer-events-auto grid shrink-0 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
      <div className="vidrio col-span-2 flex items-center gap-3 rounded-xl px-3 py-2 lg:col-span-1">
        <Gauge
          real={real}
          planned={plan}
          proyectado={proyectado}
          quieto={quieto}
        />
        {/* La tarjeta del medidor NO repite el porcentaje de al lado: pone las
            HH, que es el otro dato de cabecera del informe. */}
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-white/60 2xl:text-xs">
            {proyectado ? 'Programa a la fecha' : 'Real contra programa'}
          </p>
          {hh ? (
            <>
              <p className="text-sm font-bold tabular-nums 2xl:text-xl">
                {cantidad(hh.hechas)} <span className="text-white/60">HH</span>
              </p>
              <p className="truncate text-[11px] text-white/70 2xl:text-xs">
                de {cantidad(hh.totales)} del contrato
              </p>
            </>
          ) : (
            <p className="text-xs text-white/80 2xl:text-sm">Programa {porcentaje(plan)}%</p>
          )}
        </div>
      </div>

      <Indicador
        etiqueta="Avance real"
        valor={real}
        sufijo="%"
        pie={real === null ? 'Semana sin corte' : corte ? corte.etiqueta : `Al ${fechaLarga(data.asOf)}`}
        clase="text-sky-300"
        quieto={quieto}
      />
      <Indicador
        etiqueta="Programado"
        valor={plan}
        sufijo="%"
        pie={corte ? `Al cierre ${corte.control.weeks[corte.semana]?.code ?? ''}` : `Al ${fechaLarga(data.asOf)}`}
        clase="text-amber-300"
        quieto={quieto}
      />
      <Indicador
        etiqueta="Desviación"
        valor={desviacion}
        sufijo=" pp"
        signo
        pie="Real menos programa"
        clase={est.clase}
        quieto={quieto}
      />

      <div className="vidrio flex flex-col justify-center rounded-xl px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-white/60 2xl:text-xs">Estado</span>
        <span className={`mt-0.5 flex items-center gap-2 text-base font-bold 2xl:text-lg 2xl:text-xl ${est.clase}`}>
          <span className="relative flex size-2.5" aria-hidden>
            {!quieto && (
              <span
                className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${est.punto}`}
              />
            )}
            <span className={`relative inline-flex size-2.5 rounded-full ${est.punto}`} />
          </span>
          {desviacion === null ? 'Sin informe' : est.label}
        </span>
        <span className="mt-0.5 truncate text-[11px] text-white/70 2xl:text-xs">
          {fechaLarga(data.programStart)} al {fechaLarga(data.programEnd)}
        </span>
      </div>
    </div>
  );
}

function Indicador({
  etiqueta,
  valor,
  sufijo,
  pie,
  clase = 'text-white',
  signo = false,
  quieto,
}: {
  etiqueta: string;
  /** `null` cuando la semana elegida todavía no tiene informe. */
  valor: number | null;
  sufijo: string;
  pie: string;
  clase?: string;
  signo?: boolean;
  quieto: boolean;
}): ReactNode {
  const mostrado = useConteo(valor ?? 0, !quieto && valor !== null);
  const texto =
    valor === null
      ? '—'
      : `${signo && mostrado > 0 ? '+' : ''}${porcentaje(mostrado)}${sufijo}`;
  return (
    <div className="vidrio flex flex-col justify-center rounded-xl px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-white/60 2xl:text-xs">{etiqueta}</span>
      <span
        className={`mt-0.5 text-xl font-bold tabular-nums 2xl:text-2xl 2xl:text-3xl ${
          valor === null ? 'text-white/40' : clase
        }`}
      >
        {texto}
      </span>
      <span className="mt-0.5 truncate text-[11px] text-white/70 2xl:text-xs" title={pie}>
        {pie}
      </span>
    </div>
  );
}

// ── Gauge ────────────────────────────────────────────────────────────────────

function Gauge({
  real,
  planned,
  proyectado,
  quieto,
}: {
  real: number | null;
  planned: number;
  proyectado: boolean;
  quieto: boolean;
}): ReactNode {
  const R = 46;
  const CIRC = 2 * Math.PI * R;
  // Solo 3/4 de la circunferencia: el hueco de abajo deja respirar el número.
  const ARCO = CIRC * 0.75;
  // Sin informe el medidor muestra el programa, en ámbar: la aguja tiene que
  // decir qué está midiendo, no quedarse en cero como si la obra no avanzara.
  const valor = real ?? planned;
  const color = proyectado ? COLOR_PLAN : COLOR_REAL;
  const mostrado = useConteo(valor, !quieto);
  const avance = Math.min(100, Math.max(0, mostrado));
  const marca = Math.min(100, Math.max(0, planned));

  return (
    <div className="relative shrink-0">
      <svg
        viewBox="0 0 120 120"
        className="size-[68px] -rotate-[135deg] 2xl:size-[80px]"
        role="img"
        aria-label={`${proyectado ? 'Avance programado' : 'Avance real'} ${porcentaje(valor)}%, programa ${porcentaje(planned)}%`}
      >
        <title>
          {proyectado
            ? `Programa ${porcentaje(planned)}%`
            : `Real ${porcentaje(valor)}% · programa ${porcentaje(planned)}%`}
        </title>
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          stroke="rgb(255 255 255 / 0.18)"
          strokeDasharray={`${ARCO} ${CIRC}`}
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={`${(ARCO * avance) / 100} ${CIRC}`}
        />
        {/* Marca del programa: dónde debería ir la obra a esa fecha. */}
        {!proyectado && (
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            strokeWidth="13"
            stroke={COLOR_PLAN}
            strokeDasharray={`2 ${CIRC}`}
            strokeDashoffset={-(ARCO * marca) / 100}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums 2xl:text-base">
        {porcentaje(mostrado)}%
      </span>
    </div>
  );
}

// ── Leyenda y filtros del mapa ───────────────────────────────────────────────

/**
 * La leyenda ES el filtro: cada ficha explica un color y además lo aísla.
 *
 * Va en HORIZONTAL al pie del mapa y no en una columna: explica los puntos que
 * tiene encima, y apilada se comía el alto que necesitan las condiciones de
 * faena. En una pantalla angosta se envuelve en varias líneas.
 */
function LeyendaFiltros({
  puntos,
  visibles,
  sinUbicar,
  filtro,
  onFiltro,
  hayFiltro,
  proyectado,
}: {
  puntos: ObraMapPoint[];
  visibles: number;
  sinUbicar: number;
  filtro: FiltroMapa;
  onFiltro: (f: FiltroMapa) => void;
  hayFiltro: boolean;
  /** La semana que se mira es futura: los colores son del programa. */
  proyectado: boolean;
}): ReactNode {
  const cuenta = (fn: (p: ObraMapPoint) => boolean) => puntos.filter(fn).length;
  const sectores = [...new Set(puntos.map((p) => p.sector ?? 'Sin sector'))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
  const tipos = [...new Set(puntos.map((p) => p.workType))].sort();

  function alternar<T>(lista: T[], valor: T): T[] {
    return lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];
  }

  return (
    <div className="vidrio flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-xl px-3 py-1.5">
      <h3 className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide 2xl:text-sm">
        <MapPin className="size-3.5 opacity-80" aria-hidden />
        Cercos
        <span className="font-normal tabular-nums text-white/70">
          {visibles} de {puntos.length}
          {sinUbicar > 0 && <span className="text-white/50"> · {sinUbicar} sin ubicar</span>}
        </span>
      </h3>

      <ul className="flex shrink-0 items-center gap-1">
        {(['TERMINADO', 'EN_EJECUCION', 'PENDIENTE'] as const).map((estado) => {
          const activo = filtro.estados.includes(estado);
          return (
            <li key={estado}>
              <button
                type="button"
                onClick={() => onFiltro({ ...filtro, estados: alternar(filtro.estados, estado) })}
                aria-pressed={activo}
                title={`${NOMBRE_ESTADO[estado]}: ${cuenta((p) => p.status === estado)} cercos`}
                className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-colors 2xl:text-sm ${
                  activo ? 'vidrio-activo' : 'vidrio-sutil hover:bg-white/20'
                }`}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-white/70"
                  style={{ backgroundColor: COLOR_ESTADO[estado] }}
                  aria-hidden
                />
                {NOMBRE_ESTADO[estado]}
                <span className="font-semibold tabular-nums">
                  {cuenta((p) => p.status === estado)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex shrink-0 items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-white/55 2xl:text-xs">Tipo</span>
        {tipos.map((tipo) => {
          const activo = filtro.tipos.includes(tipo);
          return (
            <button
              key={tipo}
              type="button"
              onClick={() => onFiltro({ ...filtro, tipos: alternar(filtro.tipos, tipo) })}
              aria-pressed={activo}
              title={`Cercos tipo ${tipo}`}
              className={`rounded-md px-2 py-0.5 text-xs font-semibold transition-colors 2xl:text-sm ${
                activo ? 'vidrio-activo' : 'vidrio-sutil hover:bg-white/20'
              }`}
            >
              {tipo}
              <span className="ml-1 font-normal tabular-nums opacity-70">
                {cuenta((p) => p.workType === tipo)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 shrink items-center gap-1.5">
        <label
          htmlFor="filtro-sector"
          className="text-[10px] uppercase tracking-wide text-white/55 2xl:text-xs"
        >
          Sector
        </label>
        <select
          id="filtro-sector"
          value={filtro.sector ?? ''}
          onChange={(e) => onFiltro({ ...filtro, sector: e.target.value || null })}
          className="vidrio-sutil min-w-0 rounded-md px-2 py-0.5 text-xs text-white outline-none 2xl:text-sm [&>option]:bg-slate-800 [&>option]:text-white"
        >
          <option value="">Todos</option>
          {sectores.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {hayFiltro && (
        <button
          type="button"
          onClick={() => onFiltro(SIN_FILTRO)}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-white/15 px-2 py-0.5 text-xs transition-colors hover:bg-white/25"
        >
          <X className="size-3" aria-hidden />
          Quitar filtros
        </button>
      )}

      {proyectado && (
        <span className="shrink-0 rounded-md bg-amber-400/20 px-2 py-0.5 text-[10px] leading-tight text-amber-100 2xl:text-xs">
          Colores del programa, no de lo ejecutado
        </span>
      )}
    </div>
  );
}

// ── Paneles ──────────────────────────────────────────────────────────────────

interface Panel {
  id: string;
  titulo: string;
  Icon: typeof Activity;
  contenido: ReactNode;
  /** El panel no sigue a la semana elegida: siempre muestra el estado de hoy. */
  aHoy?: boolean;
}

const ICONO_CORTE: Record<ObraBreakdown['key'], typeof Activity> = {
  etapa: Layers,
  tipo: Layers,
  sector: MapPin,
};

/**
 * Cortes que SÍ siguen a la semana, porque salen de los cercos del mapa y esos
 * ya vienen llevados a la fecha elegida. El corte por etapa no puede: una
 * semana pasada no guarda qué etapa estaba cerrada, solo cuánto se llevaba.
 */
function cortarPuntos(
  puntos: ObraMapPoint[],
  clave: (p: ObraMapPoint) => string,
): ObraLine[] {
  const grupos = new Map<string, ObraMapPoint[]>();
  for (const p of puntos) {
    const k = clave(p);
    const previo = grupos.get(k);
    if (previo) previo.push(p);
    else grupos.set(k, [p]);
  }
  return [...grupos.entries()]
    .map(([nombre, grupo]) => ({
      id: nombre,
      name: nombre,
      unit: null,
      quantityTotal: grupo.length,
      quantityDone: grupo.filter((p) => p.status === 'TERMINADO').length,
      percent:
        Math.round((grupo.reduce((s, p) => s + p.percent, 0) / grupo.length) * 10) / 10,
      detail: `${grupo.length} ${grupo.length === 1 ? 'cerco' : 'cercos'}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function construirPaneles(
  data: ObraDashboard,
  puntos: ObraMapPoint[],
  corte: Corte | null,
  semana: number,
  onSemana: (i: number) => void,
): Panel[] {
  const paneles: Panel[] = [];
  const control = corte?.control ?? null;

  if (control) {
    paneles.push({
      id: 'fases',
      titulo: 'Avance por fase',
      Icon: Layers,
      contenido: <FasesControl control={control} semana={semana} />,
    });
    paneles.push({
      id: 'tabla',
      titulo: 'Control semanal por HH',
      Icon: Table2,
      contenido: <TablaControl control={control} semana={semana} onSemana={onSemana} />,
    });
  }

  if (puntos.length > 0) {
    paneles.push({
      id: 'corte-tipo',
      titulo: 'Avance por tipo de cerco',
      Icon: Layers,
      contenido: <Barras lineas={cortarPuntos(puntos, (p) => `Tipo ${p.workType}`)} />,
    });
    const porSector = cortarPuntos(puntos, (p) => p.sector ?? 'Por definir');
    if (porSector.length > 1) {
      paneles.push({
        id: 'corte-sector',
        titulo: 'Avance por sector',
        Icon: MapPin,
        contenido: <Barras lineas={porSector} />,
      });
    }
  }

  for (const c of data.breakdowns) {
    // Tipo y sector ya salen de los cercos del mapa, que sí siguen a la semana.
    if (c.key !== 'etapa' || c.lines.length === 0) continue;
    paneles.push({
      id: `corte-${c.key}`,
      titulo: c.label,
      Icon: ICONO_CORTE[c.key] ?? Layers,
      aHoy: corte !== null && semana !== control?.lastClosed,
      contenido: <Barras lineas={c.lines} />,
    });
  }

  if (data.milestones.length > 0) {
    paneles.push({
      id: 'hitos',
      titulo: 'Hitos del contrato',
      Icon: Flag,
      contenido: <Hitos items={data.milestones} hasta={corte?.cierre ?? null} />,
    });
  }

  if (data.recent.length > 0) {
    paneles.push({
      id: 'avances',
      titulo: 'Últimos avances reportados',
      Icon: Activity,
      contenido: (
        <Avances
          items={
            corte ? data.recent.filter((r) => r.date <= corte.cierre) : data.recent
          }
        />
      ),
    });
  }

  // Sin control por HH la curva física es la que va fija abajo, así que no
  // entra otra vez a la rotación.
  if (!control && data.breakdowns.length > 0) {
    for (const c of data.breakdowns) {
      if (c.key === 'etapa' || c.lines.length === 0) continue;
      paneles.push({
        id: `corte-${c.key}`,
        titulo: c.label,
        Icon: ICONO_CORTE[c.key] ?? Layers,
        contenido: <Barras lineas={c.lines} />,
      });
    }
  }

  return paneles;
}

/**
 * Arma las duplas que se muestran juntas. El orden no es mecánico: se junta lo
 * que se lee bien una sobre otra, y lo que sobre se empareja de a dos.
 */
function emparejar(paneles: Panel[], porGrupo: number): Panel[][] {
  if (porGrupo < 2) return paneles.map((p) => [p]);
  const porId = new Map(paneles.map((p) => [p.id, p]));
  const PREFERIDAS: Array<[string, string]> = [
    ['fases', 'hitos'],
    ['tabla', ''],
    ['corte-tipo', 'corte-sector'],
    ['corte-etapa', 'avances'],
  ];

  const duplas: Panel[][] = [];
  const usados = new Set<string>();
  for (const [a, b] of PREFERIDAS) {
    const par = [porId.get(a), porId.get(b)].filter((x): x is Panel => !!x);
    if (par.length === 0) continue;
    par.forEach((x) => usados.add(x.id));
    duplas.push(par);
  }
  const sobrantes = paneles.filter((p) => !usados.has(p.id));
  for (let i = 0; i < sobrantes.length; i += 2) duplas.push(sobrantes.slice(i, i + 2));
  return duplas;
}

// ── Panel: curva S del avance físico ─────────────────────────────────────────

function CurvaS({ curves }: { curves: ObraDashboard['curves'] }): ReactNode {
  const W = 620;
  const H = 300;
  const PAD = { top: 12, right: 14, bottom: 26, left: 38 };
  const [sobre, setSobre] = useState<ObraCurvePoint | null>(null);
  const todas = [...curves.early, ...curves.scheduled, ...curves.late, ...curves.real];
  if (todas.length === 0) {
    return <Vacio mensaje="Todavía no hay fechas programadas para dibujar la curva." />;
  }
  const tiempos = todas.map((p) => Date.parse(p.date));
  const minT = Math.min(...tiempos);
  const maxT = Math.max(...tiempos);
  const spanT = maxT - minT || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (iso: string) => PAD.left + ((Date.parse(iso) - minT) / spanT) * plotW;
  const y = (v: number) => PAD.top + (1 - v / 100) * plotH;
  const punto = (p: ObraCurvePoint) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`;
  const linea = (pts: ObraCurvePoint[]) => pts.map(punto).join(' ');

  const banda =
    curves.early.length > 0 && curves.late.length > 0
      ? `${linea(curves.early)} ${[...curves.late].reverse().map(punto).join(' ')}`
      : null;

  const ejeX = [minT, minT + spanT / 2, maxT];
  const isoDe = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ultimo = curves.real[curves.real.length - 1];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* `meet`, no `none`: estirar el viewBox al contenedor aplastaba la curva
          y la dejaba ilegible. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-h-0 w-full flex-1"
        role="img"
        aria-label="Curva S: avance real contra el programa"
        onMouseLeave={() => setSobre(null)}
      >
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={PAD.left}
              y1={y(g)}
              x2={W - PAD.right}
              y2={y(g)}
              stroke="rgb(255 255 255 / 0.16)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(g) + 4}
              textAnchor="end"
              fill="rgb(255 255 255 / 0.6)"
              fontSize={11}
            >
              {g}%
            </text>
          </g>
        ))}

        {banda && <polygon points={banda} fill="rgb(56 189 248 / 0.16)" />}

        {curves.late.length > 0 && (
          <polyline
            points={linea(curves.late)}
            fill="none"
            stroke="rgb(255 255 255 / 0.35)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
        )}
        {curves.early.length > 0 && (
          <polyline
            points={linea(curves.early)}
            fill="none"
            stroke="rgb(255 255 255 / 0.35)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
        )}
        {curves.scheduled.length > 0 && (
          <polyline
            points={linea(curves.scheduled)}
            fill="none"
            stroke={COLOR_PLAN}
            strokeWidth={2.5}
            strokeDasharray="7 5"
          />
        )}
        {curves.real.length > 0 && (
          <polyline
            points={linea(curves.real)}
            fill="none"
            stroke={COLOR_REAL}
            strokeWidth={3.5}
            strokeLinejoin="round"
            className="animate-trazo"
          />
        )}
        {ultimo && <circle cx={x(ultimo.date)} cy={y(ultimo.value)} r={5} fill={COLOR_REAL} />}

        {/* Puntos sensibles sobre el programa: hacen inspeccionable la curva. */}
        {curves.scheduled.map((p) => (
          <circle
            key={p.date}
            cx={x(p.date)}
            cy={y(p.value)}
            r={7}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setSobre(p)}
          />
        ))}

        {ejeX.map((t, i) => (
          <text
            key={t}
            x={PAD.left + ((t - minT) / spanT) * plotW}
            y={H - 7}
            textAnchor={i === 0 ? 'start' : i === ejeX.length - 1 ? 'end' : 'middle'}
            fill="rgb(255 255 255 / 0.6)"
            fontSize={11}
          >
            {fechaCorta(isoDe(t))}
          </text>
        ))}
      </svg>

      {sobre && (
        <div
          className="pointer-events-none absolute top-0 z-30"
          style={{ left: `calc(${(x(sobre.date) / W) * 100}% + 8px)` }}
        >
          <div className="vidrio rounded-lg px-2 py-1 text-[11px] shadow-lg shadow-slate-950/40 2xl:text-xs">
            <p className="font-semibold">{fechaCorta(sobre.date)}</p>
            <p className="text-white/70">Programa {porcentaje(sobre.value)}%</p>
          </div>
        </div>
      )}

      <div className="mt-1 flex shrink-0 flex-wrap justify-center gap-x-4 gap-y-0.5 text-[11px] text-white/70 2xl:text-xs">
        <Leyenda color={COLOR_REAL} texto="Real ejecutado" />
        <Leyenda punteado={COLOR_PLAN} texto="Programa vigente" />
        <Leyenda bloque="rgb(56 189 248 / 0.3)" texto="Margen temprano-tardío" />
      </div>
    </div>
  );
}

function Leyenda({
  color,
  punteado,
  bloque,
  texto,
}: {
  color?: string;
  punteado?: string;
  bloque?: string;
  texto: string;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      {color && <span className="h-1 w-4 rounded" style={{ backgroundColor: color }} aria-hidden />}
      {punteado && (
        <span
          className="h-0 w-4 border-t-2 border-dashed"
          style={{ borderColor: punteado }}
          aria-hidden
        />
      )}
      {bloque && (
        <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: bloque }} aria-hidden />
      )}
      {texto}
    </span>
  );
}

// ── Panel: barras ────────────────────────────────────────────────────────────

function Barras({ lineas, detalle }: { lineas: ObraLine[]; detalle?: string[] }): ReactNode {
  const auto = useDesplazadoAuto<HTMLUListElement>();
  if (lineas.length === 0) return <Vacio mensaje="Sin datos para este corte." />;
  return (
    <ul
      ref={auto}
      className="desplazable flex h-full min-h-0 flex-col justify-around gap-1 overflow-y-auto"
    >
      {lineas.map((l, i) => (
        <li key={l.id} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium 2xl:text-sm">{l.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-white/60 2xl:text-xs">
              {detalle?.[i] ??
                l.detail ??
                `${cantidad(l.quantityDone)} / ${cantidad(l.quantityTotal)}${
                  l.unit ? ` ${l.unit}` : ''
                }`}
            </span>
            <span className="w-11 shrink-0 text-right text-xs font-bold tabular-nums lg:w-14 2xl:text-sm">
              {l.percent.toLocaleString('es-CL')}%
            </span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/15"
            title={`${l.name}: ${l.percent.toLocaleString('es-CL')}%`}
          >
            <div
              className="h-full animate-barra rounded-full bg-sky-400"
              style={
                {
                  '--barra': `${Math.min(100, Math.max(0, l.percent))}%`,
                  animationDelay: `${i * 55}ms`,
                } as React.CSSProperties
              }
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Panel: hitos ─────────────────────────────────────────────────────────────

function Hitos({ items, hasta }: { items: ObraMilestone[]; hasta: string | null }): ReactNode {
  const auto = useDesplazadoAuto<HTMLOListElement>();
  return (
    <ol
      ref={auto}
      className="desplazable flex h-full min-h-0 flex-col justify-around gap-1 overflow-y-auto"
    >
      {items.map((h, i) => {
        // Un hito comprometido para una fecha anterior al corte que se mira ya
        // debería estar cumplido: se marca aunque nadie lo haya cerrado aún.
        const vencido = !!hasta && !!h.date && h.date <= hasta;
        const listo = h.done || vencido;
        return (
          <li
            key={h.id}
            className="flex animate-entrada items-center gap-2.5"
            style={{ animationDelay: `${i * 60}ms` } as React.CSSProperties}
          >
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                h.done
                  ? 'border-sky-400 bg-sky-400 text-slate-900'
                  : vencido
                    ? 'border-amber-300 text-amber-300'
                    : 'border-white/35'
              }`}
              aria-hidden
            >
              {listo && <Flag className="size-2.5" />}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-xs 2xl:text-sm ${listo ? '' : 'text-white/70'}`}
            >
              {h.name}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-white/60 2xl:text-xs">
              {fechaLarga(h.date)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Panel: últimos avances ───────────────────────────────────────────────────

function Avances({ items }: { items: ObraRecentReport[] }): ReactNode {
  const auto = useDesplazadoAuto<HTMLUListElement>();
  if (items.length === 0) {
    return <Vacio mensaje="Sin avances reportados hasta esta fecha." />;
  }
  return (
    <ul
      ref={auto}
      className="desplazable flex h-full min-h-0 flex-col justify-around gap-1 overflow-y-auto"
    >
      {items.slice(0, 8).map((r, i) => (
        <li
          key={r.id}
          className="flex animate-entrada items-center gap-2 text-xs 2xl:text-sm"
          style={{ animationDelay: `${i * 50}ms` } as React.CSSProperties}
        >
          <span className="w-20 shrink-0 tabular-nums text-white/60 lg:w-24">{fechaLarga(r.date)}</span>
          <span className="min-w-0 flex-1 truncate">{r.activityName}</span>
          <span className="shrink-0 font-semibold tabular-nums text-sky-300">
            +{cantidad(r.quantity)}
            {r.unit ? ` ${r.unit}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Vacio({ mensaje }: { mensaje: string }): ReactNode {
  return (
    <p className="flex h-full items-center justify-center text-center text-xs text-white/60 2xl:text-sm">
      {mensaje}
    </p>
  );
}
