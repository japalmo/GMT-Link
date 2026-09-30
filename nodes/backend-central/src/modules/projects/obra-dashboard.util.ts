/**
 * Dashboard de avance de OBRA (proyectos OBRAS_CIVILES).
 *
 * Distinto del dashboard de producción (`dashboard.util.ts`), que mide avance
 * BINARIO ponderado por esfuerzo (actividad completada o no). Acá el avance es
 * FÍSICO y continuo: 48 de 135 dados, 720 de 1.000 ml de zanja. Es la métrica
 * contractual de la carta Gantt y la que se proyecta en faena.
 *
 * Todo es PURO (sin Prisma) para poder probarlo con datos fijos.
 *
 * Ponderación: cada actividad pesa `cantidad × duración planificada`, un proxy
 * de esfuerzo que sale solo del programa y no exige que nadie cargue pesos a
 * mano. Así "Excavación de 135 dados en 20 días" pesa mucho más que
 * "Instalación de faenas (3 un en 5 días)", que es el comportamiento correcto.
 */

import type {
  ObraActivityLine,
  ObraBreakdown,
  ObraMap,
  ObraMapPoint,
  ObraPointPhoto,
  TaskCrewMember,
  ObraPointStatus,
  ObraCurvePoint,
  ObraDashboard,
  ObraLine,
  ObraMilestone,
  ObraPhase,
  ObraRecentReport,
} from '@gmt-platform/contracts';

export type { ObraDashboard };

const MS_DAY = 86_400_000;

/** Reporte de avance de un día. */
export interface ProgressEntry {
  id: string;
  date: Date;
  quantity: number;
}

/**
 * Una actividad de obra como la necesita el cálculo. Es la ENTRADA del util,
 * no parte del contrato de la API: por eso vive acá y no en `contracts`.
 */
export interface ObraActivity {
  id: string;
  name: string;
  phaseId: string;
  phaseName: string;
  unit: string | null;
  /** Cantidad contractual. `null` en hitos. */
  quantityTotal: number | null;
  isMilestone: boolean;
  /** Programa vigente. */
  start: Date | null;
  end: Date | null;
  /** CPM: ventana temprana y tardía. Sin ellas no hay banda en la curva S. */
  earlyStart: Date | null;
  earlyFinish: Date | null;
  lateStart: Date | null;
  lateFinish: Date | null;
  progress: ProgressEntry[];
  /**
   * Actividad de la que cuelga. En el Cierre Perimetral cada cerco es el padre
   * y sus 7 etapas de montaje son las hijas. El padre NO se mide: su avance es
   * el de sus hijas, si no la obra contaría dos veces lo mismo.
   */
  parentId?: string | null;
  /** Ubicación en terreno (WGS84). Solo la traen los cercos. */
  lat?: number | null;
  lng?: number | null;
}

function dayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Suma de lo reportado para una actividad. */
export function doneOf(a: ObraActivity): number {
  return a.progress.reduce((s, p) => s + p.quantity, 0);
}

/**
 * Peso de la actividad: cantidad × días de duración. Los hitos pesan 0 (no
 * aportan avance físico, solo marcan fechas). Si una actividad no tiene fechas
 * se le asigna 1 día para que no desaparezca de la ponderación.
 */
export function weightOf(a: ObraActivity): number {
  if (a.isMilestone || !a.quantityTotal || a.quantityTotal <= 0) return 0;
  const days = a.start && a.end ? Math.max(1, (a.end.getTime() - a.start.getTime()) / MS_DAY) : 1;
  return a.quantityTotal * days;
}

/**
 * Fracción planificada de una actividad a una fecha, repartiendo su cantidad
 * LINEALMENTE entre `desde` y `hasta`. Es la convención estándar de curva S
 * cuando no hay perfil de producción por actividad.
 */
function plannedFractionAt(at: Date, desde: Date | null, hasta: Date | null): number {
  if (!desde || !hasta) return 0;
  const t = at.getTime();
  const a = desde.getTime();
  const b = hasta.getTime();
  if (t <= a) return 0;
  if (t >= b) return 1;
  if (b === a) return 1;
  return (t - a) / (b - a);
}

/** Días (a medianoche) que cubren el programa, para muestrear las curvas. */
function timeline(acts: ObraActivity[]): Date[] {
  const ts: number[] = [];
  for (const a of acts) {
    for (const d of [a.start, a.end, a.earlyStart, a.lateFinish]) if (d) ts.push(d.getTime());
    for (const p of a.progress) ts.push(p.date.getTime());
  }
  if (ts.length === 0) return [];
  const ini = new Date(Math.min(...ts));
  const fin = new Date(Math.max(...ts));
  ini.setUTCHours(0, 0, 0, 0);
  fin.setUTCHours(0, 0, 0, 0);
  // Una muestra por semana mantiene la curva liviana sin perder forma; se
  // agrega siempre el último día para que la curva cierre en el 100%.
  const out: Date[] = [];
  for (let t = ini.getTime(); t <= fin.getTime(); t += 7 * MS_DAY) out.push(new Date(t));
  const ultimoDia = out[out.length - 1];
  if (!ultimoDia || ultimoDia.getTime() !== fin.getTime()) out.push(fin);
  return out;
}

/** Curva planificada acumulada usando el par de fechas que se indique. */
function plannedCurve(
  acts: ObraActivity[],
  dias: Date[],
  totalWeight: number,
  desde: (a: ObraActivity) => Date | null,
  hasta: (a: ObraActivity) => Date | null,
): ObraCurvePoint[] {
  if (totalWeight <= 0) return [];
  return dias.map((d) => {
    let acc = 0;
    for (const a of acts) {
      const w = weightOf(a);
      if (w > 0) acc += w * plannedFractionAt(d, desde(a), hasta(a));
    }
    return { date: dayISO(d), value: Math.round((acc / totalWeight) * 1000) / 10 };
  });
}

/**
 * Curva REAL acumulada. Solo llega hasta el último día con reporte: dibujarla
 * hasta el fin del programa la haría parecer estancada en el futuro.
 */
function realCurve(acts: ObraActivity[], dias: Date[], totalWeight: number): ObraCurvePoint[] {
  if (totalWeight <= 0) return [];
  const reportes: Array<{ t: number; w: number }> = [];
  for (const a of acts) {
    const total = a.quantityTotal ?? 0;
    const w = weightOf(a);
    if (w <= 0 || total <= 0) continue;
    for (const p of a.progress) {
      reportes.push({ t: p.date.getTime(), w: (p.quantity / total) * w });
    }
  }
  if (reportes.length === 0) return [];
  const ultimo = Math.max(...reportes.map((r) => r.t));
  const out: ObraCurvePoint[] = [];
  for (const d of dias) {
    if (d.getTime() > ultimo) break;
    const acc = reportes.filter((r) => r.t <= d.getTime()).reduce((s, r) => s + r.w, 0);
    out.push({ date: dayISO(d), value: Math.round((acc / totalWeight) * 1000) / 10 });
  }
  // El punto del último reporte, para que la curva termine donde está la obra.
  const accFinal = reportes.reduce((s, r) => s + r.w, 0);
  const fin = dayISO(new Date(ultimo));
  const ultimoPunto = out[out.length - 1];
  if (!ultimoPunto || ultimoPunto.date !== fin) {
    out.push({ date: fin, value: Math.round((accFinal / totalWeight) * 1000) / 10 });
  }
  return out;
}

function semaforo(dev: number): ObraDashboard['status'] {
  if (dev >= 1) return 'ADELANTADO';
  if (dev >= -1) return 'EN_LINEA';
  if (dev >= -5) return 'LEVE_ATRASO';
  return 'ATRASADO';
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
}

/** Acumulado de un conjunto de actividades medibles. */
function acumulado(acts: ObraActivity[]): {
  done: number;
  total: number;
  weight: number;
  ponderado: number;
} {
  let done = 0;
  let total = 0;
  let weight = 0;
  let ponderado = 0;
  for (const a of acts) {
    const t = a.quantityTotal ?? 0;
    const d = Math.min(doneOf(a), t);
    const w = weightOf(a);
    done += d;
    total += t;
    weight += w;
    if (w > 0 && t > 0) ponderado += w * (d / t);
  }
  return { done, total, weight, ponderado };
}

/** Porcentaje ponderado de un grupo; cae al simple si nadie tiene peso. */
function porcentajeDe(grupo: ObraActivity[]): number {
  const { done, total, weight, ponderado } = acumulado(grupo);
  return weight > 0 ? Math.round((ponderado / weight) * 1000) / 10 : pct(done, total);
}

/**
 * Avance ponderado de un grupo contando SOLO lo reportado hasta `at`. Es lo
 * mismo que `porcentajeDe`, pero mirando el cierre de una semana pasada: sin
 * esto el mapa solo sabría dibujar el estado de hoy.
 */
function porcentajeAl(grupo: ObraActivity[], at: Date): number {
  let peso = 0;
  let ponderado = 0;
  for (const a of grupo) {
    const total = a.quantityTotal ?? 0;
    const w = weightOf(a);
    if (w <= 0 || total <= 0) continue;
    const hecho = a.progress
      .filter((p) => p.date.getTime() <= at.getTime())
      .reduce((sum, p) => sum + p.quantity, 0);
    peso += w;
    ponderado += w * Math.min(1, Math.max(0, hecho / total));
  }
  return peso > 0 ? Math.round((ponderado / peso) * 1000) / 10 : 0;
}

/**
 * Avance que el programa espera de un grupo a una fecha. Mirar una semana
 * futura con esto es la proyección: qué cercos deberían estar listos para el
 * cierre de esa semana si la obra sigue el programa.
 */
function planificadoAl(grupo: ObraActivity[], at: Date): number {
  let peso = 0;
  let ponderado = 0;
  for (const a of grupo) {
    const w = weightOf(a);
    if (w <= 0) continue;
    peso += w;
    ponderado += w * plannedFractionAt(at, a.start, a.end);
  }
  return peso > 0 ? Math.round((ponderado / peso) * 1000) / 10 : 0;
}

/** Unidad común de un grupo, o `null` si mezcla unidades (un cerco mezcla). */
function unidadComun(acts: ObraActivity[]): string | null {
  const unidades = new Set(acts.map((a) => a.unit).filter((u): u is string => !!u));
  return unidades.size === 1 ? ([...unidades][0] ?? null) : null;
}

/** Convierte una actividad medible en su línea de avance. */
function lineaDe(a: ObraActivity): ObraLine {
  const total = a.quantityTotal ?? 0;
  const done = Math.min(doneOf(a), total);
  return {
    id: a.id,
    name: a.name,
    unit: a.unit,
    quantityTotal: total,
    quantityDone: done,
    percent: pct(done, total),
  };
}

/**
 * Orden de ejecución: por fecha de programa y, a igualdad, por nombre. El
 * alfabético no sirve acá porque los cercos van en romanos (A-IX iría antes
 * que A-V) y las etapas se leerían fuera de secuencia.
 */
function porPrograma(x: ObraActivity, y: ObraActivity): number {
  return (
    (x.start?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (y.start?.getTime() ?? Number.MAX_SAFE_INTEGER) || x.name.localeCompare(y.name, 'es')
  );
}

/** ¿La actividad está terminada? Sirve para contar etapas listas de un cerco. */
function terminada(a: ObraActivity): boolean {
  const total = a.quantityTotal ?? 0;
  return total > 0 && doneOf(a) >= total;
}

/**
 * Agrupa actividades medibles bajo una etiqueta. El porcentaje es PONDERADO:
 * una partida grande no puede pesar lo mismo que una chica solo por ser una
 * línea más de la lista.
 */
function agrupar(
  acts: ObraActivity[],
  etiqueta: (a: ObraActivity) => string | null,
  orden?: string[],
  detalle?: (grupo: ObraActivity[]) => string,
): ObraLine[] {
  const mapa = new Map<string, ObraActivity[]>();
  for (const a of acts) {
    const clave = etiqueta(a);
    if (clave === null) continue;
    const previo = mapa.get(clave);
    if (previo) previo.push(a);
    else mapa.set(clave, [a]);
  }
  const lineas: ObraLine[] = [...mapa.entries()].map(([nombre, grupo]) => {
    const { done, total } = acumulado(grupo);
    return {
      id: nombre,
      name: nombre,
      unit: unidadComun(grupo),
      quantityTotal: total,
      quantityDone: done,
      percent: porcentajeDe(grupo),
      ...(detalle ? { detail: detalle(grupo) } : {}),
    };
  });
  if (orden) {
    const posicion = new Map(orden.map((k, i) => [k, i]));
    return lineas.sort(
      (x, y) =>
        (posicion.get(x.name) ?? 999) - (posicion.get(y.name) ?? 999) ||
        x.name.localeCompare(y.name, 'es'),
    );
  }
  return lineas.sort((x, y) => x.name.localeCompare(y.name, 'es'));
}

/** Arma el dashboard completo de una obra. */
export function computeObraDashboard(
  projectId: string,
  projectName: string,
  activities: ObraActivity[],
  now: Date,
  control: {
    /** Cierres de semana del control, en orden. Vacío en obras sin programa. */
    semanas?: Date[];
    /** Cuántas de esas semanas tienen informe. El resto es proyección. */
    informadas?: number;
    /** Fotos de avance por cerco, indexadas por el id de la actividad padre. */
    fotos?: Map<string, ObraPointPhoto[]>;
    /** Cuadrilla por TAREA. Un cerco hereda la de todas sus etapas. */
    cuadrillas?: Map<string, TaskCrewMember[]>;
  } = {},
): ObraDashboard {
  // Una actividad con hijas es un AGRUPADOR (un cerco), no algo que se mida:
  // su avance sale de sus hijas. Medir las dos contaría dos veces la misma obra.
  const conHijas = new Set(activities.map((a) => a.parentId).filter((id): id is string => !!id));
  const porId = new Map(activities.map((a) => [a.id, a]));
  const medibles = activities.filter((a) => !a.isMilestone && !conHijas.has(a.id));

  const totalWeight = medibles.reduce((s, a) => s + weightOf(a), 0);

  // ── Avance real ponderado ──
  const realProgress =
    totalWeight > 0 ? Math.round((acumulado(medibles).ponderado / totalWeight) * 1000) / 10 : 0;

  // ── Avance planificado a la fecha, con el programa vigente ──
  let accPlan = 0;
  for (const a of medibles) {
    const w = weightOf(a);
    if (w > 0) accPlan += w * plannedFractionAt(now, a.start, a.end);
  }
  const plannedProgress = totalWeight > 0 ? Math.round((accPlan / totalWeight) * 1000) / 10 : 0;
  const deviation = Math.round((realProgress - plannedProgress) * 10) / 10;

  // ── Fases → actividades → etapas ──
  const porFase = new Map<string, ObraActivity[]>();
  for (const a of medibles) {
    const previo = porFase.get(a.phaseId);
    if (previo) previo.push(a);
    else porFase.set(a.phaseId, [a]);
  }

  const inicioFase = (acts: ObraActivity[]): number =>
    Math.min(...acts.map((a) => a.start?.getTime() ?? Number.MAX_SAFE_INTEGER));

  const phases: ObraPhase[] = [...porFase.entries()]
    .sort(([, a], [, b]) => inicioFase(a) - inicioFase(b))
    .map(([phaseId, acts]) => {
      // Dentro de la fase, cada actividad cuelga de su padre (el cerco) o va
      // suelta (una zanja, un letrero).
      const porPadre = new Map<string, ObraActivity[]>();
      for (const a of acts) {
        const clave = a.parentId ?? a.id;
        const previo = porPadre.get(clave);
        if (previo) previo.push(a);
        else porPadre.set(clave, [a]);
      }

      const inicioDe = (grupo: ObraActivity[]): number =>
        Math.min(...grupo.map((a) => a.start?.getTime() ?? Number.MAX_SAFE_INTEGER));

      const lineas: Array<ObraActivityLine & { desde: number }> = [...porPadre.entries()].map(
        ([clave, grupo]) => {
          const suelta = grupo.length === 1 && grupo[0]?.id === clave;
          const { done, total } = acumulado(grupo);
          const cabeza = grupo[0];
          return {
            desde: inicioDe(grupo),
            id: clave,
            name: (suelta ? cabeza?.name : porId.get(clave)?.name) ?? clave,
            unit: suelta ? (cabeza?.unit ?? null) : unidadComun(grupo),
            quantityTotal: total,
            quantityDone: done,
            percent: porcentajeDe(grupo),
            steps: suelta ? [] : grupo.slice().sort(porPrograma).map(lineaDe),
            stepsDone: suelta ? (terminada(cabeza!) ? 1 : 0) : grupo.filter(terminada).length,
            stepsTotal: grupo.length,
          };
        },
      );

      return {
        id: phaseId,
        name: acts[0]?.phaseName ?? 'Sin fase',
        unit: null,
        quantityTotal: acumulado(acts).total,
        quantityDone: acumulado(acts).done,
        percent: porcentajeDe(acts),
        activities: lineas
          .sort((x, y) => x.desde - y.desde || x.name.localeCompare(y.name, 'es'))
          .map(({ desde: _desde, ...linea }) => linea),
      };
    });

  // ── Cortes transversales ──
  // Las etapas se ordenan por fecha de ejecución, no alfabéticamente: en la TV
  // se leen como la secuencia de trabajo real.
  // Una tarea que cuelga de un cerco ES una etapa de montaje, y su nombre es el
  // nombre canónico de esa etapa. El tipo y el sector salen del nombre del padre.
  const etapaDe = (a: ObraActivity): string | null => (a.parentId ? a.name : null);
  const nombreCerco = (a: ObraActivity): string | null =>
    a.parentId ? (porId.get(a.parentId)?.name ?? null) : a.name;

  const ordenEtapas = [
    ...new Set(
      medibles
        .slice()
        .sort((x, y) => (x.start?.getTime() ?? 0) - (y.start?.getTime() ?? 0))
        .map(etapaDe)
        .filter((e): e is string => !!e),
    ),
  ];

  /** Cuántos cercos distintos hay en un grupo de etapas. */
  const cuentaCercos = (grupo: ObraActivity[]): string => {
    const cercos = new Set(grupo.map((a) => a.parentId ?? a.id));
    return `${cercos.size} ${cercos.size === 1 ? 'cerco' : 'cercos'}`;
  };

  const breakdowns: ObraBreakdown[] = [];
  const porEtapa = agrupar(medibles, etapaDe, ordenEtapas);
  if (porEtapa.length > 0) {
    breakdowns.push({ key: 'etapa', label: 'Avance por etapa', lines: porEtapa });
  }
  const porTipo = agrupar(
    medibles,
    (a) => {
      const tipo = tipoDeCerco(nombreCerco(a));
      return tipo ? `Cerco tipo ${tipo}` : null;
    },
    undefined,
    cuentaCercos,
  );
  if (porTipo.length > 0) {
    breakdowns.push({ key: 'tipo', label: 'Avance por tipo de cerco', lines: porTipo });
  }
  // Cortar por sector solo aporta si hay más de un sector con obra asignada.
  const porSector = agrupar(
    medibles.filter((a) => tipoDeCerco(nombreCerco(a)) !== null),
    (a) => sectorDeCerco(nombreCerco(a)) ?? 'Por definir',
    undefined,
    cuentaCercos,
  );
  if (porSector.length > 1) {
    breakdowns.push({ key: 'sector', label: 'Avance por sector', lines: porSector });
  }

  // ── Mapa de la faena ──
  // Un cerco es su padre; las coordenadas viven en las etapas (que son las
  // filas con ubicación), así que se toma la primera que la traiga. La
  // agrupación es propia: la de las fases vive dentro de cada fase.
  const porCerco = new Map<string, ObraActivity[]>();
  for (const a of medibles) {
    const clave = a.parentId ?? a.id;
    const previo = porCerco.get(clave);
    if (previo) previo.push(a);
    else porCerco.set(clave, [a]);
  }

  const puntos: ObraMapPoint[] = [];
  let sinUbicar = 0;
  for (const [clave, grupo] of porCerco.entries()) {
    const codigo = codigoDeCerco(porId.get(clave)?.name ?? grupo[0]?.name);
    if (!codigo) continue;
    const conCoords = grupo.find((a) => a.lat != null && a.lng != null);
    if (!conCoords || conCoords.lat == null || conCoords.lng == null) {
      sinUbicar += 1;
      continue;
    }
    const porcentaje = porcentajeDe(grupo);
    const terminadas = grupo.filter(terminada).length;
    const estado: ObraPointStatus =
      terminadas >= grupo.length ? 'TERMINADO' : porcentaje > 0 ? 'EN_EJECUCION' : 'PENDIENTE';
    // La etapa actual es la primera sin terminar, en orden de programa: es la
    // que la cuadrilla está haciendo o la que sigue.
    const enCurso =
      estado === 'EN_EJECUCION'
        ? (grupo
            .slice()
            .sort(porPrograma)
            .find((a) => !terminada(a))?.name ?? null)
        : null;
    // Historia y proyección del cerco, para que el mapa siga a la semana que
    // se esté mirando. El real llega hasta la última semana informada; el plan
    // llega hasta el fin de obra.
    const semanas = control.semanas ?? [];
    const informadas = Math.min(control.informadas ?? 0, semanas.length);
    const realByWeek: number[] = [];
    const planByWeek: number[] = [];
    for (let w = 0; w < semanas.length; w += 1) {
      const cierre = semanas[w];
      if (!cierre) continue;
      if (w < informadas) realByWeek.push(porcentajeAl(grupo, cierre));
      planByWeek.push(planificadoAl(grupo, cierre));
    }

    // La cuadrilla del cerco es la unión de las de sus etapas, sin repetir a
    // nadie: quien está en tres etapas del mismo cerco es una sola persona ahí.
    const porPersona = new Map<string, TaskCrewMember>();
    for (const a of [...grupo, { id: clave }]) {
      for (const m of control.cuadrillas?.get(a.id) ?? []) {
        const previo = porPersona.get(m.userId);
        // Si es jefe en alguna etapa, se muestra como jefe del cerco.
        if (!previo || (m.lead && !previo.lead)) porPersona.set(m.userId, m);
      }
    }
    const cuadrilla = [...porPersona.values()].sort(
      (x, y) => Number(y.lead) - Number(x.lead) || x.lastName.localeCompare(y.lastName, 'es'),
    );

    puntos.push({
      id: clave,
      code: codigo,
      workType: tipoDeCerco(porId.get(clave)?.name ?? grupo[0]?.name) ?? '',
      sector: sectorDeCerco(porId.get(clave)?.name ?? grupo[0]?.name),
      lat: conCoords.lat,
      lng: conCoords.lng,
      percent: porcentaje,
      stepsDone: terminadas,
      stepsTotal: grupo.length,
      status: estado,
      currentStep: enCurso,
      realByWeek,
      planByWeek,
      photos: control.fotos?.get(clave) ?? [],
      crewCount: cuadrilla.length,
      crew: cuadrilla,
    });
  }
  const map: ObraMap = {
    points: puntos.sort((x, y) => x.code.localeCompare(y.code, 'es')),
    unlocated: sinUbicar,
  };

  // ── Últimos avances reportados ──
  const recent: ObraRecentReport[] = medibles
    .flatMap((a) => {
      const padre = a.parentId ? porId.get(a.parentId)?.name : null;
      return a.progress.map((r) => ({
        id: r.id,
        date: dayISO(r.date),
        activityName: padre ? `${padre} · ${a.name}` : a.name,
        quantity: r.quantity,
        unit: a.unit,
      }));
    })
    .sort((x, y) => y.date.localeCompare(x.date) || y.id.localeCompare(x.id))
    .slice(0, 12);

  // ── Hitos ──
  const milestones: ObraMilestone[] = activities
    .filter((a) => a.isMilestone)
    .map((a) => ({
      id: a.id,
      name: a.name,
      date: a.end ? dayISO(a.end) : null,
      done: a.end ? a.end.getTime() <= now.getTime() : false,
    }))
    .sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));

  // ── Curvas ──
  const dias = timeline(activities);
  const curves = {
    early: plannedCurve(
      medibles,
      dias,
      totalWeight,
      (a) => a.earlyStart,
      (a) => a.earlyFinish,
    ),
    scheduled: plannedCurve(
      medibles,
      dias,
      totalWeight,
      (a) => a.start,
      (a) => a.end,
    ),
    late: plannedCurve(
      medibles,
      dias,
      totalWeight,
      (a) => a.lateStart,
      (a) => a.lateFinish,
    ),
    real: realCurve(medibles, dias, totalWeight),
  };

  const inicios = medibles.map((a) => a.start).filter((d): d is Date => d !== null);
  const fines = medibles.map((a) => a.end).filter((d): d is Date => d !== null);

  return {
    projectId,
    projectName,
    realProgress,
    plannedProgress,
    deviation,
    status: semaforo(deviation),
    phases,
    breakdowns,
    map,
    // Ni el clima ni el control por HH salen del cálculo: los adjunta el
    // servicio, que es quien sale a la red y a las otras tablas. Acá viajan en
    // null para que el contrato quede completo.
    weather: null,
    control: null,
    recent,
    milestones,
    curves,
    programStart: inicios.length
      ? dayISO(new Date(Math.min(...inicios.map((d) => d.getTime()))))
      : null,
    programEnd: fines.length ? dayISO(new Date(Math.max(...fines.map((d) => d.getTime())))) : null,
    asOf: dayISO(now),
  };
}

/**
 * Convención de nombre de un cerco: `Cerco <CÓDIGO> · <SECTOR>`, por ejemplo
 * `Cerco A-I · PF8`. El código empieza por el tipo (A, B o C) y el sector es
 * la zona de la faena; un cerco sin ubicación confirmada va sin sector.
 *
 * Vive acá, junto al cálculo, para poder probarla sin base de datos: el
 * dashboard corta por tipo y por sector leyendo justamente esto.
 */
const NOMBRE_CERCO = /^Cerco\s+([ABC])-[IVXLCDM]+(?:\s+·\s+(.+))?$/u;

/** Código del cerco ("A-I", "B-XXVII") a partir del nombre. */
export function codigoDeCerco(nombre: string | null | undefined): string | null {
  const m = /^Cerco\s+([ABC]-[IVXLCDM]+)/u.exec(nombre ?? '');
  return m?.[1] ?? null;
}

/** Tipo de cerco (A, B o C) a partir del nombre. `null` si no es un cerco. */
export function tipoDeCerco(nombre: string | null | undefined): string | null {
  return NOMBRE_CERCO.exec(nombre ?? '')?.[1] ?? null;
}

/** Sector de la faena a partir del nombre. `null` si el cerco no tiene ubicación. */
export function sectorDeCerco(nombre: string | null | undefined): string | null {
  return NOMBRE_CERCO.exec(nombre ?? '')?.[2]?.trim() || null;
}
