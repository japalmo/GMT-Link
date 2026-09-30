import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  HardHat,
  Layers,
  Truck,
} from 'lucide-react';
import type { ObraControl, ObraWeek } from '@gmt-platform/contracts';
import { useDesplazadoAuto } from './obra-piezas';

/**
 * Curva S del control de avance por HH, con el mismo lenguaje del informe que
 * se le entrega al cliente (GMT-MB-OOCC-CS-xx): barras de avance SEMANAL y
 * curvas de avance ACUMULADO, programa contra real.
 *
 * Es el gráfico que manda en el tablero, así que vive fijo abajo y no entra a
 * la rotación: en una reunión de obra nadie quiere esperar a que vuelva.
 *
 * Se puede inspeccionar semana por semana. Pasar el cursor muestra la ficha de
 * esa semana; hacer clic la SELECCIONA, y esa selección mueve todo el tablero.
 */

// El programa es ámbar y lo real es celeste en todo el tablero. La curva
// respeta esa convención para que nadie tenga que releer la leyenda.
export const COLOR_PLAN = '#fbbf24';
export const COLOR_REAL = '#38bdf8';

function numero(n: number, dec = 1): string {
  return n.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Fecha ISO a dd-mm, que es como se rotula una semana en faena. */
function diaMes(iso: string): string {
  const [, m, d] = iso.split('-');
  return m && d ? `${d}-${m}` : iso;
}

// ── Navegador de semanas ─────────────────────────────────────────────────────

/**
 * Flechas para recorrer el control semana a semana. Hacia atrás se ven los
 * cortes ya informados; hacia adelante, lo que el programa proyecta. El rótulo
 * dice siempre cuál de las dos cosas se está mirando: confundir un informe con
 * una proyección es el error caro de un tablero de obra.
 */
export function NavegadorSemana({
  control,
  semana,
  onSemana,
}: {
  control: ObraControl;
  semana: number;
  onSemana: (i: number) => void;
}): ReactNode {
  const actual = control.weeks[semana];
  if (!actual) return null;
  const informada = semana <= control.lastClosed;
  const ultimo = control.weeks.length - 1;

  return (
    <div className="pointer-events-auto flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSemana(Math.max(0, semana - 1))}
        disabled={semana === 0}
        aria-label="Semana anterior"
        className="rounded-md p-1 text-white/75 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => onSemana(Math.max(0, control.lastClosed))}
        title="Volver al último corte informado"
        className="min-w-[122px] rounded-md px-2 py-0.5 text-center transition-colors hover:bg-white/10"
      >
        <span className="block text-sm font-bold tabular-nums leading-tight">
          {actual.code} · {diaMes(actual.closeDate)}
        </span>
        <span
          className={`block text-[10px] uppercase tracking-wide 2xl:text-xs ${
            informada ? 'text-emerald-300' : 'text-amber-300'
          }`}
        >
          {informada ? 'Informado' : 'Proyectado'}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onSemana(Math.min(ultimo, semana + 1))}
        disabled={semana === ultimo}
        aria-label="Semana siguiente"
        className="rounded-md p-1 text-white/75 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}

// ── Curva ────────────────────────────────────────────────────────────────────

/**
 * Mide la caja del gráfico. El viewBox se arma con esos mismos píxeles para
 * que una unidad del SVG sea una unidad de pantalla: con un viewBox fijo y
 * `preserveAspectRatio="none"` el gráfico se estira y los rótulos quedan
 * deformados, que es justo lo que hace ilegible una curva en una TV ancha.
 */
function useCaja(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [caja, setCaja] = useState({ w: 900, h: 220 });
  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const ro = new ResizeObserver(([entrada]) => {
      const r = entrada?.contentRect;
      if (r && r.width > 0 && r.height > 0) {
        setCaja({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    ro.observe(nodo);
    return () => ro.disconnect();
  }, []);
  return [ref, caja];
}

export function CurvaControl({
  control,
  semana,
  onSemana,
  quieto,
}: {
  control: ObraControl;
  semana: number;
  onSemana: (i: number) => void;
  quieto: boolean;
}): ReactNode {
  const [sobre, setSobre] = useState<number | null>(null);
  const [caja, medida] = useCaja();
  const weeks = control.weeks;

  const W = medida.w;
  const H = medida.h;
  const PAD = { top: 14, right: 46, bottom: 26, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // La escala de las barras se ajusta al máximo real de la obra y no a un 100%
  // fijo: con semanales de 3% a 17%, un eje a 100 dejaría las barras planas.
  const techo = useMemo(() => {
    const maximo = Math.max(...weeks.map((w) => Math.max(w.parPlan, w.parReal ?? 0)), 5);
    return Math.ceil(maximo / 5) * 5;
  }, [weeks]);

  const banda = plotW / weeks.length;
  const centro = (i: number) => PAD.left + banda * (i + 0.5);
  const yBarra = (v: number) => PAD.top + (1 - v / techo) * plotH;
  const yLinea = (v: number) => PAD.top + (1 - v / 100) * plotH;

  const acmPlan = weeks.map((w, i) => `${centro(i).toFixed(1)},${yLinea(w.acmPlan).toFixed(1)}`);
  const acmReal = weeks
    .filter((w): w is ObraWeek & { acmReal: number } => w.acmReal !== null)
    .map((w) => `${centro(w.index).toFixed(1)},${yLinea(w.acmReal).toFixed(1)}`);

  const foco = sobre ?? semana;
  const enFoco = weeks[foco];
  const anchoBarra = Math.min(26, banda * 0.34);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={caja} className="min-h-0 w-full flex-1 overflow-hidden">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block"
          role="img"
          aria-label="Avance semanal y curva S: programa contra real"
          onMouseLeave={() => setSobre(null)}
        >
          {/* Grilla del acumulado, que es el eje que se lee de lejos. */}
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line
                x1={PAD.left}
                y1={yLinea(g)}
                x2={W - PAD.right}
                y2={yLinea(g)}
                stroke="rgb(255 255 255 / 0.14)"
                strokeWidth={1}
              />
              <text
                x={W - PAD.right + 6}
                y={yLinea(g) + 4}
                fill="rgb(255 255 255 / 0.55)"
                fontSize={11}
              >
                {g}%
              </text>
            </g>
          ))}
          {[0, techo / 2, techo].map((g) => (
            <text
              key={g}
              x={PAD.left - 6}
              y={yBarra(g) + 4}
              textAnchor="end"
              fill="rgb(255 255 255 / 0.45)"
              fontSize={11}
            >
              {numero(g, 0)}%
            </text>
          ))}

          {/* Semana seleccionada: la franja que ancla todo el tablero. */}
          <rect
            x={PAD.left + banda * foco}
            y={PAD.top}
            width={banda}
            height={plotH}
            fill="rgb(255 255 255 / 0.09)"
          />

          {weeks.map((w, i) => (
            <g key={w.code}>
              {/* Barra del programa: hueca, porque es el fondo contra el que se
                compara, no el dato que importa. */}
              <rect
                x={centro(i) - anchoBarra}
                y={yBarra(w.parPlan)}
                width={anchoBarra}
                height={Math.max(0, plotH + PAD.top - yBarra(w.parPlan))}
                fill="rgb(251 191 36 / 0.30)"
                stroke={COLOR_PLAN}
                strokeWidth={1}
                className={quieto ? '' : 'animate-barra-alto'}
                style={{ animationDelay: `${i * 45}ms` }}
              />
              {w.parReal !== null && (
                <rect
                  x={centro(i)}
                  y={yBarra(w.parReal)}
                  width={anchoBarra}
                  height={Math.max(0, plotH + PAD.top - yBarra(w.parReal))}
                  fill={COLOR_REAL}
                  className={quieto ? '' : 'animate-barra-alto'}
                  style={{ animationDelay: `${i * 45}ms` }}
                />
              )}
            </g>
          ))}

          <polyline
            points={acmPlan.join(' ')}
            fill="none"
            stroke={COLOR_PLAN}
            strokeWidth={2.5}
            strokeDasharray="7 5"
            strokeLinejoin="round"
          />
          {acmReal.length > 1 && (
            <polyline
              points={acmReal.join(' ')}
              fill="none"
              stroke={COLOR_REAL}
              strokeWidth={3.5}
              strokeLinejoin="round"
              className={quieto ? '' : 'animate-trazo'}
            />
          )}
          {weeks.map((w) =>
            w.acmReal === null ? null : (
              <circle
                key={w.code}
                cx={centro(w.index)}
                cy={yLinea(w.acmReal)}
                r={w.index === control.lastClosed ? 5.5 : 3.5}
                fill={COLOR_REAL}
              />
            ),
          )}

          {/* En un celular la banda queda en 28 px y "S-10" no cabe: se rotula una
            de cada dos, más la que esté en foco, que es la que importa. */}
          {weeks.map((w, i) =>
            banda >= 34 || i % 2 === 0 || i === foco ? (
              <text
                key={w.code}
                x={centro(i)}
                y={H - 10}
                textAnchor="middle"
                fill={i === foco ? 'rgb(255 255 255 / 0.95)' : 'rgb(255 255 255 / 0.55)'}
                fontSize={11}
                fontWeight={i === foco ? 700 : 400}
              >
                {w.code}
              </text>
            ) : null,
          )}

          {/* Zonas sensibles al final: capturan el cursor sin tapar el dibujo. */}
          {weeks.map((w, i) => (
            <rect
              key={w.code}
              x={PAD.left + banda * i}
              y={PAD.top}
              width={banda}
              height={plotH}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setSobre(i)}
              onClick={() => onSemana(i)}
            >
              <title>{`${w.code}, cierre ${diaMes(w.closeDate)}`}</title>
            </rect>
          ))}
        </svg>
      </div>

      {/* La ficha aparece solo al pasar el cursor: dejarla fija taparía las
          barras, y los datos de la semana elegida ya están en los indicadores. */}
      {sobre !== null && enFoco && (
        <FichaSemana
          semana={enFoco}
          informada={enFoco.index <= control.lastClosed}
          izquierda={(foco + 0.5) / weeks.length}
        />
      )}

      <div className="mt-1 flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[11px] text-white/70 2xl:text-xs">
        <LeyendaCurva caja={`${COLOR_PLAN}4d`} borde={COLOR_PLAN} texto="Semanal programa" />
        <LeyendaCurva caja={COLOR_REAL} texto="Semanal real" />
        <LeyendaCurva punteado={COLOR_PLAN} texto="Acumulado programa" />
        <LeyendaCurva linea={COLOR_REAL} texto="Acumulado real" />
      </div>
    </div>
  );
}

/** Ficha flotante de la semana bajo el cursor. Es el detalle del informe. */
function FichaSemana({
  semana,
  informada,
  izquierda,
}: {
  semana: ObraWeek;
  informada: boolean;
  izquierda: number;
}): ReactNode {
  // Se ancla al lado contrario cuando la semana está al borde, para que la
  // ficha no se salga del panel en S-0 ni en la última.
  const derecha = izquierda > 0.62;
  return (
    <div
      className="pointer-events-none absolute top-1 z-30 w-[172px]"
      style={
        derecha
          ? { right: `calc(${(1 - izquierda) * 100}% + 10px)` }
          : { left: `calc(${izquierda * 100}% + 10px)` }
      }
    >
      <div className="vidrio rounded-lg px-2.5 py-2 shadow-lg shadow-slate-950/40">
        <p className="flex items-baseline justify-between gap-2 text-xs font-bold 2xl:text-sm">
          {semana.code}
          <span className="text-[10px] font-normal text-white/60 2xl:text-xs">
            {diaMes(semana.closeDate)}
          </span>
        </p>
        <dl className="mt-1 flex flex-col gap-0.5 text-[11px] 2xl:text-xs">
          <Dupla rotulo="Semanal prog." valor={`${numero(semana.parPlan)}%`} color={COLOR_PLAN} />
          <Dupla
            rotulo="Semanal real"
            valor={semana.parReal === null ? 'Sin informe' : `${numero(semana.parReal)}%`}
            color={COLOR_REAL}
          />
          <Dupla rotulo="Acum. prog." valor={`${numero(semana.acmPlan)}%`} color={COLOR_PLAN} />
          <Dupla
            rotulo="Acum. real"
            valor={semana.acmReal === null ? 'Sin informe' : `${numero(semana.acmReal)}%`}
            color={COLOR_REAL}
          />
          <Dupla rotulo="HH programa" valor={numero(semana.hhPlan, 0)} />
        </dl>
        {semana.deviation !== null ? (
          <p
            className={`mt-1 border-t border-white/10 pt-1 text-[11px] font-semibold 2xl:text-xs ${
              semana.deviation >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {semana.deviation >= 0 ? '+' : ''}
            {numero(semana.deviation)} pp vs programa
          </p>
        ) : (
          <p className="mt-1 border-t border-white/10 pt-1 text-[11px] text-white/55 2xl:text-xs">
            {informada ? 'Semana sin cierre' : 'Semana futura'}
          </p>
        )}
      </div>
    </div>
  );
}

function Dupla({
  rotulo,
  valor,
  color,
}: {
  rotulo: string;
  valor: string;
  color?: string;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex min-w-0 items-center gap-1.5 truncate text-white/65">
        {color && (
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden
          />
        )}
        {rotulo}
      </dt>
      <dd className="shrink-0 font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}

function LeyendaCurva({
  caja,
  borde,
  linea,
  punteado,
  texto,
}: {
  caja?: string;
  borde?: string;
  linea?: string;
  punteado?: string;
  texto: string;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      {caja && (
        <span
          className="h-2.5 w-3.5 rounded-sm border"
          style={{ backgroundColor: caja, borderColor: borde ?? caja }}
          aria-hidden
        />
      )}
      {linea && <span className="h-1 w-4 rounded" style={{ backgroundColor: linea }} aria-hidden />}
      {punteado && (
        <span
          className="h-0 w-4 border-t-2 border-dashed"
          style={{ borderColor: punteado }}
          aria-hidden
        />
      )}
      {texto}
    </span>
  );
}

// ── Panel: la tabla del informe ──────────────────────────────────────────────

/**
 * Las mismas filas del informe, para leer los números exactos.
 *
 * Las cuatro columnas de porcentaje se agrupan bajo "Semanal" y "Acumulado":
 * repetir "Sem. prog. / Sem. real / Acum. prog. / Acum. real" en el encabezado
 * era la mitad del ruido de la tabla. El color hace el resto del trabajo, el
 * mismo del gráfico: ámbar es programa y celeste es real.
 *
 * Una semana sin informe deja la celda VACÍA en vez de poner una raya. Doce
 * rayas seguidas se leen como un dato, y no hay ninguno.
 */
export function TablaControl({
  control,
  semana,
  onSemana,
}: {
  control: ObraControl;
  semana: number;
  onSemana: (i: number) => void;
}): ReactNode {
  const auto = useDesplazadoAuto<HTMLDivElement>();
  const celda = 'py-1 pl-2 text-right tabular-nums';

  return (
    <div ref={auto} className="desplazable h-full min-h-0 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[11px] 2xl:text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th
              rowSpan={2}
              className="border-b border-white/15 bg-slate-950/95 py-1 pr-2 text-left align-bottom text-[10px] font-medium uppercase tracking-wide text-white/45 backdrop-blur"
            >
              Semana
            </th>
            <th
              rowSpan={2}
              className="border-b border-white/15 bg-slate-950/95 py-1 pl-2 text-right align-bottom text-[10px] font-medium uppercase tracking-wide text-white/45 backdrop-blur"
            >
              HH
            </th>
            <th
              colSpan={2}
              className="border-b border-white/10 bg-slate-950/95 pb-0.5 pl-2 text-right text-[10px] font-medium uppercase tracking-wide text-white/45 backdrop-blur"
            >
              Semanal
            </th>
            <th
              colSpan={2}
              className="border-b border-white/10 bg-slate-950/95 pb-0.5 pl-3 text-right text-[10px] font-medium uppercase tracking-wide text-white/45 backdrop-blur"
            >
              Acumulado
            </th>
            <th
              rowSpan={2}
              className="border-b border-white/15 bg-slate-950/95 py-1 pl-2 text-right align-bottom text-[10px] font-medium uppercase tracking-wide text-white/45 backdrop-blur"
            >
              pp
            </th>
          </tr>
          <tr>
            <RotuloSerie color={COLOR_PLAN} texto="prog." />
            <RotuloSerie color={COLOR_REAL} texto="real" />
            <RotuloSerie color={COLOR_PLAN} texto="prog." separa />
            <RotuloSerie color={COLOR_REAL} texto="real" />
          </tr>
        </thead>
        <tbody>
          {control.weeks.map((w) => {
            const elegida = w.index === semana;
            const informada = w.index <= control.lastClosed;
            return (
              <tr
                key={w.code}
                onClick={() => onSemana(w.index)}
                aria-current={elegida}
                className={`cursor-pointer transition-colors ${
                  elegida ? 'bg-white/12' : 'hover:bg-white/[0.06]'
                } ${informada ? '' : 'text-white/45'}`}
              >
                <td className="whitespace-nowrap py-1 pr-2">
                  {/* La barra de la izquierda marca la semana elegida sin teñir
                      la fila entera, que es lo que hacía parpadear la tabla. */}
                  <span
                    className={`mr-1.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full ${
                      elegida ? 'bg-sky-400' : 'bg-transparent'
                    }`}
                    aria-hidden
                  />
                  <span className={elegida ? 'font-semibold' : ''}>{w.code}</span>{' '}
                  <span className="text-white/40">{diaMes(w.closeDate)}</span>
                </td>
                <td className={`${celda} text-white/55`}>{numero(w.hhPlan, 0)}</td>
                <td className={celda}>{numero(w.parPlan)}</td>
                <td className={`${celda} text-sky-300`}>
                  {w.parReal === null ? '' : numero(w.parReal)}
                </td>
                <td className={`${celda} pl-3`}>{numero(w.acmPlan)}</td>
                <td className={`${celda} text-sky-300`}>
                  {w.acmReal === null ? '' : numero(w.acmReal)}
                </td>
                <td
                  className={`${celda} font-semibold ${
                    w.deviation === null
                      ? ''
                      : w.deviation >= 0
                        ? 'text-emerald-300'
                        : 'text-rose-300'
                  }`}
                >
                  {w.deviation === null
                    ? ''
                    : `${w.deviation >= 0 ? '+' : ''}${numero(w.deviation)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Rótulo de una serie en el encabezado: el punto de color dice cuál es. */
function RotuloSerie({
  color,
  texto,
  separa = false,
}: {
  color: string;
  texto: string;
  separa?: boolean;
}): ReactNode {
  return (
    <th
      className={`border-b border-white/15 bg-slate-950/95 py-0.5 text-right text-[10px] font-medium text-white/50 backdrop-blur ${
        separa ? 'pl-3' : 'pl-2'
      }`}
    >
      <span className="inline-flex items-center gap-1">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        {texto}
      </span>
    </th>
  );
}

// ── Panel: avance por fase en la semana elegida ──────────────────────────────

/**
 * Las tres fases que pesan HH, con lo programado y lo real de la semana que se
 * esté mirando. Es el panel que explica POR QUÉ la curva va donde va.
 */
export function FasesControl({
  control,
  semana,
}: {
  control: ObraControl;
  semana: number;
}): ReactNode {
  const auto = useDesplazadoAuto<HTMLUListElement>();
  return (
    <ul
      ref={auto}
      className="desplazable flex h-full min-h-0 flex-col justify-around gap-2 overflow-y-auto"
    >
      {control.phases.map((f, i) => {
        const plan = f.plan[semana] ?? f.plan.at(-1) ?? 0;
        const real = f.real[semana] ?? null;
        const Icono = ICONO_FASE[f.name] ?? Layers;
        return (
          <li
            key={f.name}
            className="min-w-0 animate-entrada"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium 2xl:text-sm">
                <Icono className="size-3.5 shrink-0 opacity-75" aria-hidden />
                {f.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-white/55 2xl:text-xs">
                {numero(f.hh, 0)} HH · {f.activities} act.
              </span>
              <span className="w-14 shrink-0 text-right text-xs font-bold tabular-nums 2xl:text-sm">
                {real === null ? (
                  <span className="text-amber-300">{numero(plan)}%</span>
                ) : (
                  <span className="text-sky-300">{numero(real)}%</span>
                )}
              </span>
            </div>
            {/* Una sola pista con las dos marcas: el relleno es lo real y la
                muesca ámbar es dónde debería ir el programa. */}
            <div className="relative mt-1 h-2 w-full overflow-hidden rounded-full bg-white/12">
              <div
                className="h-full animate-barra rounded-full bg-sky-400"
                style={
                  {
                    '--barra': `${Math.min(100, Math.max(0, real ?? 0))}%`,
                    animationDelay: `${i * 70}ms`,
                  } as React.CSSProperties
                }
              />
              <span
                className="absolute inset-y-0 w-0.5 bg-amber-300"
                style={{ left: `calc(${Math.min(100, Math.max(0, plan))}% - 1px)` }}
                title={`Programa ${numero(plan)}%`}
                aria-hidden
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Un icono por fase: en una TV el símbolo se reconoce antes que la palabra. */
const ICONO_FASE: Record<string, typeof Layers> = {
  Hitos: Flag,
  Gestión: ClipboardList,
  Suministros: Truck,
  Construcción: HardHat,
  Cierre: CheckCircle2,
};
