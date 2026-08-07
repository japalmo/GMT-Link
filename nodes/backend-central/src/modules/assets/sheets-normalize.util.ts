/**
 * Normalización de los registros que llegan desde la planilla del checklist.
 *
 * La planilla es la fuente legada: la llenan desde un formulario de AppScript y
 * arrastra años de escritura libre. Antes de guardar nada en la base hay que
 * dejar los datos comparables, porque si no el mismo vehículo aparece como
 * cuatro vehículos distintos.
 *
 * Lo que se vio en los 2.136 registros reales:
 *
 *   - la MISMA patente escrita de cuatro formas: `SKRF88`, `SK RF 88`,
 *     `SKRF-88`, `SI RF 88`;
 *   - patentes envueltas en una frase: "FURGÓN SURAY 17 PASAJEROS PATENTE
 *     VHBC 22";
 *   - registros de prueba con la patente literal "PRUEBA";
 *   - fechas como texto en formato chileno (`14/05/2025 9:34:27`), no como
 *     fecha;
 *   - estados con espacios de más y mayúsculas inconsistentes.
 *
 * Módulo PURO: sin Prisma ni Nest, para poder probarlo contra los datos reales
 * sin base de datos.
 */

/** Quita tildes y pasa a mayúsculas, para comparar sin sorpresas. */
function sinTildes(texto: string): string {
  // El rango va escrito con escapes y no con los caracteres literales: son
  // marcas combinantes invisibles, y pegadas en el código cualquier editor o
  // copia las puede alterar sin que se vea nada raro.
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Patentes chilenas: cuatro letras y dos dígitos (formato desde 2007) o dos
 * letras y cuatro dígitos (formato antiguo).
 */
const PATENTE_NUEVA = /\b([A-Z]{4})[\s.-]?(\d{2})\b/;
const PATENTE_ANTIGUA = /\b([A-Z]{2})[\s.-]?(\d{4})\b/;

/** Valores que NO son una patente aunque estén escritos en la columna. */
const NO_ES_PATENTE = new Set(['PRUEBA', 'TEST', 'N/A', 'NA', 'SIN PATENTE', '']);

/**
 * Extrae la patente de un texto libre.
 *
 * Devuelve `null` cuando no hay ninguna reconocible, en vez de inventar una: un
 * checklist atribuido al vehículo equivocado es peor que un checklist sin
 * vehículo, porque ensucia el kilometraje de una camioneta que sí existe.
 */
export function normalizarPatente(crudo: unknown): string | null {
  if (crudo === null || crudo === undefined) return null;
  const texto = sinTildes(String(crudo)).toUpperCase().trim();
  if (NO_ES_PATENTE.has(texto)) return null;

  // Primero el texto pegado: "SK RF 88" -> "SKRF88" cae en el patrón nuevo.
  const pegado = texto.replace(/[\s.-]/g, '');
  const directo = /^([A-Z]{4})(\d{2})$/.exec(pegado) ?? /^([A-Z]{2})(\d{4})$/.exec(pegado);
  if (directo) return `${directo[1]}${directo[2]}`;

  // Si no, se busca la patente DENTRO de la frase: "FURGÓN SURAY PATENTE
  // VHBC-22" -> VHBC22.
  const enFrase = PATENTE_NUEVA.exec(texto) ?? PATENTE_ANTIGUA.exec(texto);
  if (enFrase) return `${enFrase[1]}${enFrase[2]}`;

  // Último intento sobre el texto pegado, por si la frase venía sin espacios.
  const enPegado = PATENTE_NUEVA.exec(pegado) ?? PATENTE_ANTIGUA.exec(pegado);
  return enPegado ? `${enPegado[1]}${enPegado[2]}` : null;
}

/**
 * Fecha de la planilla a `Date`.
 *
 * Acepta el texto chileno (`14/05/2025 9:34:27`, día primero), el ISO que a
 * veces devuelve la API, y el número de serie de la hoja de cálculo. Devuelve
 * `null` si no se puede interpretar: una fecha inventada desordenaría toda la
 * serie del odómetro, que se ordena justamente por fecha.
 */
export function normalizarFecha(crudo: unknown): Date | null {
  if (crudo === null || crudo === undefined || crudo === '') return null;
  if (crudo instanceof Date) return Number.isNaN(crudo.getTime()) ? null : crudo;

  // Número de serie de hoja de cálculo (días desde el 30/12/1899).
  if (typeof crudo === 'number' && Number.isFinite(crudo)) {
    if (crudo < 1 || crudo > 100_000) return null;
    return new Date(Math.round((crudo - 25_569) * 86_400_000));
  }

  const texto = String(crudo).trim();
  if (!texto) return null;

  // dd/mm/aaaa [hh:mm[:ss]] — el formato que devuelve la planilla viva. Se
  // interpreta DÍA primero a propósito: en Chile 05/06 es 5 de junio, y leerlo
  // al revés movería el registro casi un mes sin que nadie lo note.
  const cl = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    texto,
  );
  if (cl) {
    const [, d, m, a, hh = '0', mm = '0', ss = '0'] = cl;
    return desdeHoraChilena(
      Number(a),
      Number(m),
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
    );
  }

  const iso = new Date(texto);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

/** Huso de la planilla: la hora que muestra es la que ve una persona en Chile. */
const HUSO_PLANILLA = 'America/Santiago';

/**
 * Cuánto se aparta del UTC el huso de la planilla en ESE instante.
 *
 * Se calcula con `Intl` y no con un número fijo porque Chile cambia de hora dos
 * veces al año: fijar -4 desplazaría medio año de registros en una hora.
 */
function desfaseDelHuso(instante: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: HUSO_PLANILLA,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const p = Object.fromEntries(partes.map((x) => [x.type, x.value])) as Record<string, string>;
  // `Intl` devuelve 24 para la medianoche en algunos entornos; Date.UTC lo
  // interpretaría como el día siguiente y el desfase saldría con 24 h de error.
  const hora = p.hour === '24' ? 0 : Number(p.hour);
  const comoSiFueraUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hora,
    Number(p.minute),
    Number(p.second),
  );
  return comoSiFueraUTC - instante.getTime();
}

/**
 * Construye la fecha a partir de una hora de PARED chilena.
 *
 * La planilla guarda "14/05/2025 9:34:27" sin decir de qué huso habla: es la
 * hora que ve quien la abre en Chile. Interpretarla con el huso del SERVIDOR
 * haría que la misma fila entrara distinta según dónde corra el proceso: en esta
 * máquina (Chile) queda bien, pero la API corre en Railway con el reloj en UTC,
 * y ahí cada checklist se guardaría cuatro horas corrido. Los de la madrugada
 * cambiarían de día y el gráfico de uso los contaría en la fecha equivocada.
 */
export function desdeHoraChilena(
  anio: number,
  mes: number,
  dia: number,
  hh = 0,
  mm = 0,
  ss = 0,
): Date | null {
  const tentativa = Date.UTC(anio, mes - 1, dia, hh, mm, ss);
  if (Number.isNaN(tentativa)) return null;
  // Se resta el desfase medido en la propia tentativa. Basta una pasada: el
  // error residual solo aparecería en la hora exacta del cambio de horario.
  const fecha = new Date(tentativa - desfaseDelHuso(new Date(tentativa)));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Número de la planilla: acepta "1.234,5", "1234.5" y el número puro. */
export function normalizarNumero(crudo: unknown): number | null {
  if (crudo === null || crudo === undefined || crudo === '') return null;
  if (typeof crudo === 'number') return Number.isFinite(crudo) ? crudo : null;

  let texto = String(crudo).trim().replace(/\s/g, '');
  if (!texto) return null;
  // Formato chileno: el punto separa miles y la coma los decimales.
  if (/,\d{1,2}$/.test(texto)) texto = texto.replace(/\./g, '').replace(',', '.');
  else texto = texto.replace(/\.(?=\d{3}\b)/g, '');

  const soloNumero = texto.replace(/[^\d.-]/g, '');
  // Sin este guardia, "no sé" quedaba en cadena vacía y `Number('')` da 0: un
  // kilometraje que nadie supo responder se guardaría como un odómetro en CERO
  // y arrastraría toda la serie del vehículo hacia abajo.
  if (!/\d/.test(soloNumero)) return null;

  const n = Number(soloNumero);
  return Number.isFinite(n) ? n : null;
}

/** Estados válidos de un ítem, en la escritura canónica de la plantilla. */
// Incluye los niveles de AdBlue, que no son Bueno/Regular/Malo. Las fracciones
// salen de los datos reales: "1/4" aparece 17 veces en la planilla.
const ESTADOS = [
  'Bueno',
  'Regular',
  'Malo',
  'Lleno',
  '3/4',
  'Medio',
  '1/4',
  'Bajo',
  'N/A',
] as const;

/**
 * Estado de un ítem a su forma canónica. `null` si no se reconoce, para que el
 * ítem quede sin responder en vez de guardar un valor que la plantilla no
 * declara y que después no calzaría con ninguna opción.
 */
export function normalizarEstado(crudo: unknown): string | null {
  if (crudo === null || crudo === undefined) return null;
  const texto = sinTildes(String(crudo)).trim().toUpperCase();
  if (!texto) return null;
  const encontrado = ESTADOS.find((e) => sinTildes(e).toUpperCase() === texto);
  return encontrado ?? null;
}

/** "Si"/"No" de la planilla a booleano. `null` si no es ninguno de los dos. */
export function normalizarBooleano(crudo: unknown): boolean | null {
  if (typeof crudo === 'boolean') return crudo;
  if (crudo === null || crudo === undefined) return null;
  const texto = sinTildes(String(crudo)).trim().toUpperCase();
  if (['SI', 'S', 'TRUE', 'VERDADERO', '1'].includes(texto)) return true;
  if (['NO', 'N', 'FALSE', 'FALSO', '0'].includes(texto)) return false;
  return null;
}

/**
 * Texto libre: recorta y colapsa espacios. Devuelve `null` para lo vacío, de
 * modo que "sin observación" y "observación en blanco" sean lo mismo.
 */
export function normalizarTexto(crudo: unknown): string | null {
  if (crudo === null || crudo === undefined) return null;
  const texto = String(crudo).replace(/\s+/g, ' ').trim();
  return texto === '' ? null : texto;
}

/**
 * Nombre de persona: recorta espacios y deja cada palabra con inicial mayúscula.
 *
 * NO intenta corregir la escritura ni cruzarla con un usuario: los registros que
 * vienen de la planilla se guardan tal cual llegaron (decisión del dueño), y el
 * nombre queda como texto informativo, no como una atribución de autoría.
 */
export function normalizarNombre(crudo: unknown): string | null {
  const texto = normalizarTexto(crudo);
  if (!texto) return null;
  return texto
    .split(' ')
    .map((p, i) => {
      const bajo = p.toLowerCase();
      // Las partículas van en minúscula, salvo que abran el nombre: "María de
      // los Ángeles", no "María De Los Ángeles".
      if (i > 0 && PARTICULAS.has(bajo)) return bajo;
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Partículas que no se capitalizan dentro de un nombre. */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos']);
