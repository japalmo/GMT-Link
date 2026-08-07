/**
 * Uso de un vehículo a partir del odómetro reportado en sus checklists.
 *
 * Cada checklist de vehículo captura "Kilometraje actual (odómetro)" con el id
 * de ítem `kilometraje`. Con esa serie se calculan los promedios de uso y la
 * proyección de la próxima mantención.
 *
 * ── El problema que este módulo existe para resolver ───────────────────────
 *
 * Los datos reales traen LECTURAS QUE RETROCEDEN: entre un 3% y un 6% de los
 * checklists reportan un odómetro menor que el anterior. Un odómetro no baja;
 * son errores de tipeo al cargar. Si se promedian tal cual, una sola lectura mal
 * escrita mete un salto que ensucia el promedio y termina dando una fecha de
 * mantención equivocada, que es justo lo que la función viene a evitar.
 *
 * Por eso las lecturas inconsistentes se DESCARTAN del cálculo y se devuelven
 * aparte: sirven para que alguien las corrija, y mientras tanto no contaminan
 * ningún número.
 *
 * ── Lo que esta limpieza NO cubre ──────────────────────────────────────────
 *
 * Solo detecta lecturas que van hacia ABAJO, porque son las que contradicen la
 * física de un odómetro. Un dígito de más (escribir 520.000 donde iba 52.000)
 * pasa el filtro: sube, así que parece válido. Ese error inflaría el recorrido y
 * adelantaría la mantención proyectada.
 *
 * No se filtra por "salto demasiado grande" a propósito: el umbral sería
 * arbitrario y una camioneta de faena puede hacer 600 km en un día legítimamente.
 * Descartar eso en silencio sería peor que el error que evita. La defensa
 * correcta es que la UI muestre la serie y el operador vea el pico.
 *
 * Módulo PURO: sin Prisma ni Nest, para probar la aritmética sin base de datos.
 */

/** Id del ítem de checklist que guarda el odómetro (estable en las plantillas). */
export const ITEM_ODOMETRO = 'kilometraje';

/** Intervalo de mantención de la flota, en kilómetros (decisión del dueño). */
export const INTERVALO_MANTENCION_KM = 10_000;

export interface LecturaOdometro {
  fecha: Date;
  km: number;
  /** Quién ejecutó el checklist, para el historial y el uso por conductor. */
  conductor?: string;
}

export interface LecturaDescartada extends LecturaOdometro {
  /** Por qué se descartó, en texto que el operador pueda entender. */
  motivo: string;
}

export interface SerieUso {
  /** Lecturas válidas, ordenadas de la más antigua a la más reciente. */
  lecturas: LecturaOdometro[];
  /** Lecturas que no se pudieron usar, con su motivo. */
  descartadas: LecturaDescartada[];
}

export type Granularidad = 'dia' | 'semana' | 'mes';

export interface PuntoUso {
  /** Inicio del período (ISO, día). */
  periodo: string;
  /** Kilómetros recorridos EN ese período. */
  km: number;
}

/**
 * Ordena y limpia la serie de odómetro.
 *
 * Descarta lecturas no numéricas y las que retroceden respecto del máximo visto:
 * se compara contra el MÁXIMO y no contra la anterior a propósito, porque si no
 * una lectura errónea muy alta dejaría fuera a todas las correctas que vengan
 * después.
 */
export function limpiarSerie(crudas: LecturaOdometro[]): SerieUso {
  const ordenadas = [...crudas].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  const lecturas: LecturaOdometro[] = [];
  const descartadas: LecturaDescartada[] = [];
  let maximo = -Infinity;

  for (const l of ordenadas) {
    if (!Number.isFinite(l.km) || l.km < 0) {
      descartadas.push({ ...l, motivo: 'El kilometraje no es un número válido.' });
      continue;
    }
    if (lecturas.length > 0 && l.km < maximo) {
      descartadas.push({
        ...l,
        motivo: `Retrocede respecto del máximo registrado (${Math.round(maximo).toLocaleString('es-CL')} km).`,
      });
      continue;
    }
    lecturas.push(l);
    maximo = Math.max(maximo, l.km);
  }
  return { lecturas, descartadas };
}

/** Inicio del período que contiene a `fecha`, según la granularidad. */
export function inicioDePeriodo(fecha: Date, granularidad: Granularidad): Date {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  if (granularidad === 'mes') {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  if (granularidad === 'semana') {
    // Semana que empieza el LUNES: es como se planifica el trabajo en faena,
    // no el domingo que trae JavaScript por defecto.
    const diaSemana = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diaSemana);
    return d;
  }
  return d;
}

/**
 * Kilómetros recorridos por período.
 *
 * El recorrido de un período es la diferencia entre su última lectura y la
 * última del período anterior, NO entre la primera y la última del mismo
 * período: si un vehículo tiene una sola lectura en la semana, la resta interna
 * daría cero y parecería que no se usó, cuando en realidad recorrió todo lo que
 * lo separa de la lectura previa.
 */
export function kmPorPeriodo(
  lecturas: LecturaOdometro[],
  granularidad: Granularidad,
): PuntoUso[] {
  const primeraLectura = lecturas[0];
  if (lecturas.length < 2 || !primeraLectura) return [];

  // Última lectura de cada período (las lecturas ya vienen ordenadas).
  const ultimaPorPeriodo = new Map<string, { fecha: Date; km: number }>();
  for (const l of lecturas) {
    const clave = inicioDePeriodo(l.fecha, granularidad).toISOString().slice(0, 10);
    ultimaPorPeriodo.set(clave, { fecha: l.fecha, km: l.km });
  }

  const claves = [...ultimaPorPeriodo.keys()].sort();
  const puntos: PuntoUso[] = [];
  let anterior = primeraLectura.km;

  for (const clave of claves) {
    const actual = ultimaPorPeriodo.get(clave)!;
    const km = actual.km - anterior;
    // El primer período suele dar 0 porque su última lectura ES la primera de la
    // serie; se incluye igual para no dejar un hueco en el gráfico.
    puntos.push({ periodo: clave, km: Math.max(0, Math.round(km)) });
    anterior = actual.km;
  }
  return puntos;
}

export interface PromediosUso {
  kmPorDia: number;
  kmPorSemana: number;
  kmPorMes: number;
  /** Días que cubre la serie (para saber si el promedio es representativo). */
  diasCubiertos: number;
  kmTotales: number;
}

/**
 * Promedios de uso sobre toda la serie.
 *
 * Se calcula sobre el LAPSO REAL entre la primera y la última lectura, no sobre
 * la cantidad de checklists: un vehículo con 300 checklists en un año recorre lo
 * mismo que uno con 30, y dividir por la cantidad de reportes premiaría a quien
 * más papeleo hace en vez de medir el uso.
 */
export function promedios(lecturas: LecturaOdometro[]): PromediosUso | null {
  const primera = lecturas[0];
  const ultima = lecturas[lecturas.length - 1];
  if (lecturas.length < 2 || !primera || !ultima) return null;
  const kmTotales = ultima.km - primera.km;
  const ms = ultima.fecha.getTime() - primera.fecha.getTime();
  const diasCubiertos = Math.max(1, Math.round(ms / 86_400_000));
  const kmPorDia = kmTotales / diasCubiertos;

  return {
    kmPorDia,
    kmPorSemana: kmPorDia * 7,
    kmPorMes: kmPorDia * 30,
    diasCubiertos,
    kmTotales,
  };
}

export interface ProyeccionMantencion {
  /** Odómetro en el que toca la próxima mantención. */
  kmObjetivo: number;
  /** Kilómetros que faltan para llegar. */
  kmRestantes: number;
  /** Días estimados según el promedio de uso. */
  diasEstimados: number;
  /** Fecha estimada. */
  fechaEstimada: Date;
  /** Última lectura usada como base. */
  kmActual: number;
}

/**
 * Proyecta cuándo toca la próxima mantención.
 *
 * `ultimaMantencionKm` es el odómetro de la última mantención hecha. Si no se
 * conoce, se asume el múltiplo del intervalo inmediatamente anterior al
 * kilometraje actual: es una estimación declarada, no un dato inventado, y la
 * UI debe decir que es aproximada.
 */
export function proyectarMantencion(
  lecturas: LecturaOdometro[],
  opciones: { ultimaMantencionKm?: number; intervaloKm?: number } = {},
): ProyeccionMantencion | null {
  const prom = promedios(lecturas);
  if (!prom || prom.kmPorDia <= 0) return null;

  const intervalo = opciones.intervaloKm ?? INTERVALO_MANTENCION_KM;
  const ultimaLectura = lecturas[lecturas.length - 1];
  if (!ultimaLectura) return null;
  const kmActual = ultimaLectura.km;
  const base =
    opciones.ultimaMantencionKm ?? Math.floor(kmActual / intervalo) * intervalo;

  let kmObjetivo = base + intervalo;
  // Si ya se pasó del objetivo (mantención atrasada), se apunta al siguiente
  // múltiplo por venir en vez de devolver una fecha en el pasado, que no le
  // sirve a nadie para planificar.
  while (kmObjetivo <= kmActual) {
    kmObjetivo += intervalo;
  }

  const kmRestantes = kmObjetivo - kmActual;
  const diasEstimados = Math.ceil(kmRestantes / prom.kmPorDia);
  const fechaEstimada = new Date(ultimaLectura.fecha);
  fechaEstimada.setDate(fechaEstimada.getDate() + diasEstimados);

  return { kmObjetivo, kmRestantes, diasEstimados, fechaEstimada, kmActual };
}
