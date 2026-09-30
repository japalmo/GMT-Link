import type { ObraControl, ObraControlPhase, ObraWeek } from '@gmt-platform/contracts';
import { acumuladoAl } from './avance-ponderado.util';

/**
 * Control de avance por HH: el informe semanal que GMT le entrega al cliente
 * (GMT-MB-OOCC-CS-xx). Es cálculo puro, sin Prisma, para poder probarlo con
 * números de un informe real y comparar contra el PDF firmado.
 *
 * Convive con el avance físico por cerco sin reemplazarlo. Son dos preguntas
 * distintas: el control responde "cuánto del contrato va ejecutado", ponderado
 * por horas hombre del programa; el avance físico responde "dónde está la
 * cuadrilla". El informe al cliente usa el primero, así que manda en la curva.
 */

/** Una semana del control, tal como viene de la base. */
export interface FilaSemana {
  code: string;
  index: number;
  closeDate: Date;
  hhPlan: number;
  /** Fracción 0-1, como la guarda la planilla. */
  parPlan: number;
  parReal: number | null;
  acmPlan: number;
  acmReal: number | null;
}

/** Una actividad del programa base con su reparto semanal de HH. */
export interface FilaActividad {
  wbsId: number;
  name: string;
  phase: string;
  hh: number;
  startDate: Date;
  endDate: Date;
  /** HH planificadas por semana desde S-1. Índice 0 = S-1. */
  hhByWeek: number[];
  /** Acumulado real 0-1 por semana informada, desde S-1. Índice 0 = S-1. */
  realByWeek: number[];
}

/** Escalares del control que viven en el proyecto. */
export interface CabeceraControl {
  totalHh: number | null;
  cutoffDate: Date | null;
  /** Avance del programa al corte, 0-1. El corte cae a media semana. */
  planAtCutoff: number | null;
}

/** Fracción 0-1 a porcentaje con un decimal, que es como se informa. */
function porcentaje(fraccion: number): number {
  return Math.round(fraccion * 1000) / 10;
}

function dayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * El orden de las fases en el informe es el del programa, no el alfabético:
 * primero lo que ocurre antes. Una fase que no esté en la lista va al final.
 */
const ORDEN_FASES = ['Hitos', 'Gestión', 'Suministros', 'Construcción', 'Cierre'];

function posicionFase(nombre: string): number {
  const i = ORDEN_FASES.indexOf(nombre);
  return i === -1 ? ORDEN_FASES.length : i;
}

/**
 * Avance de una fase semana a semana, ponderado por las HH de sus actividades.
 *
 * El plan sale del reparto de HH del programa (acumular lo repartido hasta esa
 * semana y dividir por el total de la fase). El real sale del avance informado
 * de cada actividad, que ya viene acumulado y en fracción.
 */
function fasesDe(actividades: FilaActividad[], semanas: number): ObraControlPhase[] {
  // Hasta dónde hay informe en el PROYECTO, no en cada fase: con la misma regla
  // que el total (`avanceSemanal`), para que el desglose y el total no puedan
  // contar semanas distintas.
  const cortes = Math.max(0, ...actividades.map((a) => a.realByWeek.length));

  const porFase = new Map<string, FilaActividad[]>();
  for (const a of actividades) {
    const previo = porFase.get(a.phase);
    if (previo) previo.push(a);
    else porFase.set(a.phase, [a]);
  }

  const fases: ObraControlPhase[] = [];
  for (const [nombre, grupo] of porFase.entries()) {
    const hh = grupo.reduce((s, a) => s + a.hh, 0);
    // Una fase de puros hitos no pesa HH: informar 0% de algo que no se mide
    // confundiría, así que no entra al informe.
    if (hh <= 0) continue;

    // `semanas` cuenta S-0; los repartos empiezan en S-1, por eso el -1.
    const tramos = Math.max(0, semanas - 1);
    const plan: number[] = [0];
    let acumuladas = 0;
    for (let w = 0; w < tramos; w += 1) {
      for (const a of grupo) acumuladas += a.hhByWeek[w] ?? 0;
      plan.push(porcentaje(acumuladas / hh));
    }

    // El real llega hasta la última semana informada del proyecto. Una
    // actividad sin dato de esa semana vale su último acumulado.
    const real: number[] = [0];
    for (let w = 0; w < cortes; w += 1) {
      let hecho = 0;
      for (const a of grupo) hecho += a.hh * acumuladoAl(a.realByWeek, w);
      real.push(porcentaje(hecho / hh));
    }

    fases.push({ name: nombre, hh, activities: grupo.length, plan, real });
  }

  return fases.sort(
    (x, y) => posicionFase(x.name) - posicionFase(y.name) || x.name.localeCompare(y.name, 'es'),
  );
}

/**
 * Arma el control de avance. Devuelve `null` cuando la obra no tiene programa
 * cargado: ahí el tablero se queda con la curva del avance físico, que es lo
 * único que hay, en vez de mostrar un informe vacío.
 */
export function computeControlSemanal(
  cabecera: CabeceraControl,
  filas: FilaSemana[],
  actividades: FilaActividad[],
): ObraControl | null {
  if (filas.length === 0 || !cabecera.totalHh || cabecera.totalHh <= 0) return null;

  const ordenadas = [...filas].sort((a, b) => a.index - b.index);
  const weeks: ObraWeek[] = ordenadas.map((f) => ({
    code: f.code,
    index: f.index,
    closeDate: dayISO(f.closeDate),
    hhPlan: Math.round(f.hhPlan * 100) / 100,
    parPlan: porcentaje(f.parPlan),
    parReal: f.parReal === null ? null : porcentaje(f.parReal),
    acmPlan: porcentaje(f.acmPlan),
    acmReal: f.acmReal === null ? null : porcentaje(f.acmReal),
    deviation: f.acmReal === null ? null : Math.round((f.acmReal - f.acmPlan) * 1000) / 10,
  }));

  // La última semana informada. S-0 vale como informada (arranca en 0) y por
  // eso el índice puede ser 0; -1 significa que no hay ningún corte todavía.
  let lastClosed = -1;
  for (const w of weeks) if (w.acmReal !== null) lastClosed = Math.max(lastClosed, w.index);

  const ultima = weeks.filter((w) => w.acmReal !== null).at(-1);
  const realPercent = ultima?.acmReal ?? 0;
  // El plan al corte NO es el de la semana: el corte cae a media semana y el
  // programa se prorratea por día. Si no vino, se cae al de la última semana
  // informada, que es la aproximación más cercana que existe con estos datos.
  const planPercent =
    cabecera.planAtCutoff !== null ? porcentaje(cabecera.planAtCutoff) : (ultima?.acmPlan ?? 0);

  const cutoff = cabecera.cutoffDate
    ? dayISO(cabecera.cutoffDate)
    : (ultima?.closeDate ?? weeks[0]?.closeDate ?? '');

  return {
    cutoff,
    totalHh: cabecera.totalHh,
    realPercent,
    planPercent,
    deviation: Math.round((realPercent - planPercent) * 10) / 10,
    weeks,
    lastClosed,
    phases: fasesDe(actividades, weeks.length),
  };
}
