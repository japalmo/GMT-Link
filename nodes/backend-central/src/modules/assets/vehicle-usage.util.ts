/**
 * Uso de un vehículo a partir del odómetro reportado en sus checklists.
 *
 * Cada checklist de vehículo captura "Kilometraje actual (odómetro)" con el id
 * de ítem `kilometraje`. Con esa serie se calculan los promedios de uso y la
 * proyección de la próxima mantención.
 *
 * ── El problema que este módulo existe para resolver ───────────────────────
 *
 * Los datos reales vienen sucios. Sobre el respaldo de producción del
 * 2026-08-07 (1.972 checklists de 17 vehículos) hay dos tipos de error de tipeo:
 *
 *   - lecturas hacia ABAJO (se escribió 5.030 donde iba 50.300);
 *   - lecturas hacia ARRIBA por un dígito de más, que son las CARAS: en
 *     GMT-VH-0008 una lectura de 586.974 km contra una mediana de 57.678
 *     inflaba el recorrido 10 veces.
 *
 * Un odómetro no retrocede, así que ambas contradicen la física del aparato.
 * Si se promedian tal cual, la fecha de mantención proyectada queda equivocada,
 * que es justo lo que este módulo viene a evitar.
 *
 * ── Cómo se limpia ────────────────────────────────────────────────────────
 *
 * Se conserva la SUBSECUENCIA NO DECRECIENTE MÁS LARGA: el mayor conjunto de
 * lecturas que pueden ser todas ciertas a la vez. El resto se devuelve aparte
 * para que alguien las corrija, y mientras tanto no contamina ningún número.
 *
 * La primera versión comparaba cada lectura contra el MÁXIMO visto. Contra los
 * datos reales resultó desastroso: una sola lectura inflada se volvía el máximo
 * y mandaba a la basura todo lo que venía después (154 de 258 lecturas en
 * GMT-VH-0008, 57% de descarte en la flota). El máximo confía en una lectura
 * cualquiera; la subsecuencia confía en la MAYORÍA, que es lo correcto cuando
 * los errores son minoría.
 *
 * No hay ningún umbral de "salto demasiado grande" a propósito: sería arbitrario
 * y una camioneta de faena puede hacer 600 km en un día legítimamente. La regla
 * es solo la física del odómetro.
 *
 * ── Lo que esta limpieza NO cubre ──────────────────────────────────────────
 *
 * DOS VEHÍCULOS EN UNA MISMA FICHA. En GMT-VH-0008 y GMT-VH-0013 conviven dos
 * series de odómetro completas y coherentes: en el primero, una densa de muchos
 * conductores que va de 55.000 a 65.837 km entre marzo y julio de 2026, y otra
 * dispersa de seis lecturas que va de 76.488 a 87.276 en las mismas fechas.
 * Alguien está cargando el odómetro de otra camioneta en esta ficha.
 *
 * Ningún algoritmo puede repartir eso bien: las dos series son internamente
 * consistentes y solo una persona sabe cuál corresponde al vehículo. Acá se
 * conserva la más larga y el resto sale en `descartadas`, que es la evidencia
 * para arreglarlo. Cuando las descartadas son muchas, el problema es la CARGA de
 * datos y no el cálculo, y la UI debe decirlo en vez de mostrar el promedio como
 * si nada.
 *
 * Se probó recortar la serie al "tramo vigente" detectando ese salto. Contra los
 * datos reales fue peor: cortaba por tipeos duplicados que se corroboran entre
 * sí y por caídas de 800 km, y le comía a GMT-VH-0006 261 de sus 303 lecturas.
 * Cada parámetro que hacía falta para afinarlo era un número ajustado a ocho
 * vehículos. Se prefirió la regla única (un odómetro no retrocede) y dejar el
 * caso raro visible.
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
 * Índices de la subsecuencia no decreciente más larga de `valores`.
 *
 * Es la formalización de "el mayor conjunto de lecturas que pueden ser todas
 * ciertas a la vez", dado que un odómetro nunca baja.
 *
 * Cuando hay empate en largo se prefiere la subsecuencia que EMPIEZA MÁS ALTO.
 * El recorrido total de una subsecuencia es `última - primera`, así que empezar
 * más alto es recorrer menos: entre dos explicaciones igual de compatibles, gana
 * la que no inventa kilómetros. Con `[50.000, 500, 50.100, 50.200]` las dos
 * candidatas miden 3, y este criterio bota el 500 en vez del 50.000.
 *
 * O(n²) a propósito: el vehículo con más historia de la flota tiene 334
 * lecturas, y la versión cuadrática deja el criterio de desempate explícito en
 * vez de escondido en el backtracking de la versión O(n log n).
 */
function indicesNoDecrecientes(valores: number[]): Set<number> {
  const n = valores.length;
  if (n === 0) return new Set();

  const largo = new Array<number>(n).fill(1);
  const primero = [...valores];
  const previo = new Array<number>(n).fill(-1);

  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (valores[j]! > valores[i]!) continue;
      const candidato = largo[j]! + 1;
      const mejorLargo = candidato > largo[i]!;
      const mismoLargoPeroEmpiezaMasAlto =
        candidato === largo[i]! && primero[j]! > primero[i]!;
      if (mejorLargo || mismoLargoPeroEmpiezaMasAlto) {
        largo[i] = candidato;
        primero[i] = primero[j]!;
        previo[i] = j;
      }
    }
  }

  let fin = 0;
  for (let i = 1; i < n; i += 1) {
    if (largo[i]! > largo[fin]! || (largo[i]! === largo[fin]! && primero[i]! > primero[fin]!)) {
      fin = i;
    }
  }

  const conservados = new Set<number>();
  for (let k = fin; k !== -1; k = previo[k]!) conservados.add(k);
  return conservados;
}

/** Describe con qué lecturas válidas choca la descartada, para poder corregirla. */
function motivoDeDescarte(km: number, anterior: number | null, siguiente: number | null): string {
  const f = (n: number): string => Math.round(n).toLocaleString('es-CL');
  if (anterior !== null && siguiente !== null) {
    return `No calza con el odómetro: entre esas fechas iba de ${f(anterior)} a ${f(siguiente)} km.`;
  }
  if (anterior !== null) {
    return `No calza con el odómetro: la última lectura válida antes es ${f(anterior)} km.`;
  }
  if (siguiente !== null) {
    return `No calza con el odómetro: la primera lectura válida después es ${f(siguiente)} km.`;
  }
  return `No hay otra lectura con la cual contrastar los ${f(km)} km.`;
}

/**
 * Ordena y limpia la serie de odómetro.
 *
 * Dos pasos: se apartan los valores no numéricos y del resto se conserva la
 * subsecuencia no decreciente más larga. Ver el comentario de cabecera del
 * módulo para por qué la limpieza no compara contra el máximo, y para el caso
 * que esta limpieza NO puede resolver sola.
 */
export function limpiarSerie(crudas: LecturaOdometro[]): SerieUso {
  const ordenadas = [...crudas].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  const numericas: LecturaOdometro[] = [];
  const descartadas: LecturaDescartada[] = [];
  for (const l of ordenadas) {
    if (!Number.isFinite(l.km) || l.km < 0) {
      descartadas.push({ ...l, motivo: 'El kilometraje no es un número válido.' });
    } else {
      numericas.push(l);
    }
  }

  const vigentes = numericas;
  const conservados = indicesNoDecrecientes(vigentes.map((l) => l.km));
  const lecturas = vigentes.filter((_, i) => conservados.has(i));

  // Las descartadas se explican contra sus vecinas CONSERVADAS, que es lo que
  // alguien necesita para saber qué debería decir la lectura mal cargada.
  vigentes.forEach((l, i) => {
    if (conservados.has(i)) return;
    let anterior: number | null = null;
    let siguiente: number | null = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (conservados.has(j)) {
        anterior = vigentes[j]!.km;
        break;
      }
    }
    for (let j = i + 1; j < vigentes.length; j += 1) {
      if (conservados.has(j)) {
        siguiente = vigentes[j]!.km;
        break;
      }
    }
    descartadas.push({ ...l, motivo: motivoDeDescarte(l.km, anterior, siguiente) });
  });

  descartadas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
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
