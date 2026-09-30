import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';

import { PLANTILLA_CHECKLIST_PDF_BASE64 } from './checklist-plantilla-pdf';

/**
 * PDF del checklist de vehículo con el FORMATO REAL de GMT.
 *
 * ── Por qué se escribe SOBRE el formato y no se redibuja ──────────────────
 *
 * El documento que se firma y se archiva es la pestaña "FORMATO CHECKLIST" de
 * la planilla que usaba la flota: una hoja carta con el logo, el dibujo de la
 * camioneta y una disposición que la gente de faena conoce de memoria. La
 * primera versión la redibujaba con pdf-lib y salía parecida pero no igual:
 * dos hojas, sin logo, sin el dibujo. Parecido no sirve para un formato.
 *
 * Así que se toma el formato real exportado de la planilla, se le borraron los
 * datos (scripts/generar-plantilla-checklist.py) y acá se escribe cada valor
 * en la MISMA posición, con la misma letra (Arial ≈ Helvetica, 6,2 pt) y la
 * misma alineación que tenía el original. El logo, las franjas y el dibujo no
 * los toca este código: son los del formato.
 *
 * Coordenadas: medidas sobre el formato original en puntos, con origen ARRIBA
 * a la izquierda como las entrega PyMuPDF. `aPdf` las pasa al origen abajo de
 * pdf-lib. Las filas de las tablas avanzan 9,125 pt exactos.
 *
 * Módulo PURO: recibe los datos ya resueltos y devuelve los bytes.
 */

// ── Tipos de datos ──────────────────────────────────────────────────────────

/** Un ítem con su respuesta, listo para ir a su fila del formato. */
export interface FilaFormato {
  /** Id del ítem en la plantilla canónica: decide en qué fila va. */
  id: string;
  etiqueta: string;
  valor: string;
  observacion?: string;
  /** El motor la considera falla. */
  esFalla?: boolean;
}

/** Un par etiqueta/valor de los bloques de datos de la cabecera. */
export interface DatoCabecera {
  etiqueta: string;
  valor: string;
  /** Vencimiento, cuando el dato es un documento. */
  vencimiento?: string;
}

/** Un documento del vehículo: la casilla se marca si está registrado. */
export interface DocumentoFormato {
  presente: boolean;
  vencimiento?: string;
}

export interface VehiculoFormato {
  patente: string;
  kilometraje: string;
  proxMant: string;
  permiso: DocumentoFormato;
  revision: DocumentoFormato;
  seguro: DocumentoFormato;
  extintor: DocumentoFormato;
}

export interface ChecklistFormatoData {
  proyecto: string;
  /** Fecha del checklist, dd/mm/aaaa como en el formato. */
  fecha: string;
  /** Nombre de quien llenó el checklist. */
  conductor: string;
  /** Licencias: [municipal, interna], como las arma `construirDatosConductor`. */
  datosConductor: readonly DatoCabecera[];
  vehiculo: VehiculoFormato;
  estadoGeneral: readonly FilaFormato[];
  equiposEmergencia: readonly FilaFormato[];
  condicionesConductor: readonly FilaFormato[];
  /** Una línea por parte marcada del diagrama. */
  carroceria: readonly string[];
  observaciones: string;
  /**
   * Respuestas que el formato no tiene dónde poner (p. ej. el nivel de
   * AdBlue, que se agregó después). Van a "Observaciones generales": perder
   * una respuesta de un documento que se firma es peor que moverla de lugar.
   */
  extras?: readonly string[];
  /**
   * Advertencias sobre el origen del documento ("sin verificar", "importado
   * de la planilla"). Van al PIE, fuera del marco, para no alterar el formato
   * y a la vez no presentar como verificado algo que no lo está.
   */
  avisos?: readonly string[];
  /** Firma a mano alzada en PNG. Ausente = no se firmó. */
  firmaPng?: Uint8Array;
  /** Qué decir cuando no hay imagen (no es lo mismo "no firmó" que "firmó en la planilla"). */
  firmaNota?: string;
}

// ── Geometría del formato (puntos, origen arriba a la izquierda) ────────────

const ALTO_PAGINA = 792;
const TAM = 6.2;
const PASO_FILA = 9.125;
const GRIS_CASILLA = rgb(0x89 / 255, 0x89 / 255, 0x89 / 255);
const NEGRO = rgb(0, 0, 0);
const BLANCO = rgb(1, 1, 1);
const ROJO = rgb(0.72, 0.11, 0.11);
const GRIS_PIE = rgb(0.45, 0.45, 0.45);

/** Filas de cada tabla, en el orden del formato, por id canónico. */
export const FILAS_GENERAL = [
  'sistemaFrenos',
  'direccion',
  'estadoMotor',
  'neumaticos',
  'neumaticoRepuesto',
  'luces',
  'bocina',
  'velocimetroIndicadores',
  'parabrisasVidrios',
  'limpiaparabrisas',
  'espejos',
  'proteccionPickupCabina',
  'carroceriaEstructura',
  'velocidadCrucero',
  'radioBase',
  'sistemaMonitoreoGPS',
  'trabatuercasCheckpointSafelock',
  'logotipoEmpresa',
  'numeroIdentificacion',
  'logoAutorizacionTransito',
] as const;
export const FILAS_EMERGENCIA = [
  'cinturonSeguridad',
  'alarmaRetroceso',
  'triangulosReflectantes',
  'extintores',
  'botiquinPrimerosAuxilios',
  'llaveRuedas',
  'gataHidraulica',
  'baliza',
  'barraAntivuelco',
  'pertigaBanderaLuz',
  'cunas',
] as const;
export const FILAS_CONDUCTOR = [
  'capacidadConducir',
  'horasDescanso',
  'medicamentosSueno',
  'problemasInquietan',
] as const;

/** Línea base de la primera fila de cada tabla. */
const BASE_GENERAL = 224.34;
const BASE_EMERGENCIA = 425.14;
const BASE_CONDUCTOR = 543.77;

/** Columnas de las tablas. */
const COL_ESTADO_CENTRO = 365.5;
const COL_OBS_X = 427;
const COL_OBS_ANCHO = 155;
const COL_RESPUESTA_CENTRO = 445.25;

/** Casillas: esquina superior izquierda, 7,6 pt de lado. */
const CASILLA = 7.6;
const CASILLAS_VEHICULO = {
  permiso: 155.1,
  revision: 164.2,
  seguro: 173.4,
  extintor: 182.5,
} as const;
const CASILLA_VEHICULO_X = 421.5;
const CASILLAS_LICENCIA_Y = [182.5, 191.6] as const;
const CASILLA_LICENCIA_X = 143;

// ── Utilidades de dibujo ────────────────────────────────────────────────────

/** Y del formato (arriba) → Y de pdf-lib (abajo). */
function aPdf(y: number): number {
  return ALTO_PAGINA - y;
}

/** Corta un texto para que quepa en `max` puntos, con puntos suspensivos. */
function recortar(texto: string, fuente: PDFFont, tam: number, max: number): string {
  if (fuente.widthOfTextAtSize(texto, tam) <= max) return texto;
  let t = texto;
  while (t.length > 1 && fuente.widthOfTextAtSize(`${t}…`, tam) > max) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Parte un texto en líneas que quepan en `max` puntos.
 *
 * Exportada para poder probar que ENVUELVE y no recorta: es la garantía que
 * impide que una observación quede a medias en un documento firmado.
 */
export function envolver(texto: string, fuente: PDFFont, tam: number, max: number): string[] {
  const lineas: string[] = [];
  for (const parrafo of texto.split('\n')) {
    let actual = '';
    for (const palabra of parrafo.split(/\s+/)) {
      const tentativa = actual ? `${actual} ${palabra}` : palabra;
      if (fuente.widthOfTextAtSize(tentativa, tam) <= max) {
        actual = tentativa;
      } else {
        if (actual) lineas.push(actual);
        actual = palabra;
      }
    }
    lineas.push(actual);
  }
  return lineas.length > 0 ? lineas : [''];
}

interface Estilo {
  fuente: PDFFont;
  tam?: number;
  color?: RGB;
  /** Ancho máximo: si no cabe, se recorta con puntos suspensivos. */
  max?: number;
}

/** Texto alineado a la izquierda, con su línea base en `base`. */
function izquierda(p: PDFPage, texto: string, x: number, base: number, e: Estilo): void {
  if (!texto) return;
  const tam = e.tam ?? TAM;
  const t = e.max ? recortar(texto, e.fuente, tam, e.max) : texto;
  p.drawText(t, { x, y: aPdf(base), size: tam, font: e.fuente, color: e.color ?? NEGRO });
}

/** Texto centrado en `centro`, como las celdas centradas de la planilla. */
function centrado(p: PDFPage, texto: string, centro: number, base: number, e: Estilo): void {
  if (!texto) return;
  const tam = e.tam ?? TAM;
  const t = e.max ? recortar(texto, e.fuente, tam, e.max) : texto;
  const ancho = e.fuente.widthOfTextAtSize(t, tam);
  p.drawText(t, {
    x: centro - ancho / 2,
    y: aPdf(base),
    size: tam,
    font: e.fuente,
    color: e.color ?? NEGRO,
  });
}

/**
 * Casilla de verificación como la dibuja Google Sheets: marcada es un cuadro
 * gris con un visto blanco; sin marcar, solo el borde.
 */
function casilla(p: PDFPage, x: number, yArriba: number, marcada: boolean): void {
  const y = aPdf(yArriba + CASILLA);
  if (!marcada) {
    p.drawRectangle({
      x,
      y,
      width: CASILLA,
      height: CASILLA,
      borderColor: GRIS_CASILLA,
      borderWidth: 0.8,
    });
    return;
  }
  p.drawRectangle({ x, y, width: CASILLA, height: CASILLA, color: GRIS_CASILLA });
  p.drawSvgPath('M 1.6 3.9 L 3.2 5.5 L 6.0 2.3', {
    x,
    y: y + CASILLA,
    borderColor: BLANCO,
    borderWidth: 0.9,
  });
}

/**
 * "02-04-2026" (formato interno) → "2/04/2026", como escribe los vencimientos
 * la planilla del formato: día sin cero a la izquierda, mes con él.
 */
function fechaDeFormato(fecha: string | undefined): string {
  if (!fecha) return '';
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(fecha);
  return m ? `${Number(m[1])}/${m[2]}/${m[3]}` : fecha;
}

// ── Composición ─────────────────────────────────────────────────────────────

/** Estado de una fila de las tablas: valor centrado + observación a la izquierda. */
function filaTabla(
  p: PDFPage,
  fila: FilaFormato | undefined,
  base: number,
  centro: number,
  fuente: PDFFont,
  desbordes: string[],
): void {
  if (!fila) return;
  centrado(p, fila.valor, centro, base, { fuente, max: 110 });
  if (fila.observacion) {
    const cabe = fuente.widthOfTextAtSize(fila.observacion, TAM) <= COL_OBS_ANCHO;
    izquierda(p, fila.observacion, COL_OBS_X, base, { fuente, max: COL_OBS_ANCHO });
    // Lo que no cabe en la celda se copia entero a observaciones generales:
    // una observación cortada en un documento firmado es una observación perdida.
    if (!cabe) desbordes.push(`${fila.etiqueta}: ${fila.observacion}`);
  }
}

function dibujarTabla(
  p: PDFPage,
  orden: readonly string[],
  filas: readonly FilaFormato[],
  primera: number,
  centro: number,
  fuente: PDFFont,
  desbordes: string[],
): void {
  const porId = new Map(filas.map((f) => [f.id, f]));
  orden.forEach((id, i) =>
    filaTabla(p, porId.get(id), primera + i * PASO_FILA, centro, fuente, desbordes),
  );
}

/** Bloque de texto libre dentro de un recuadro; lo que no cabe se avisa. */
function bloqueTexto(
  p: PDFPage,
  lineas: readonly string[],
  x: number,
  primeraBase: number,
  ancho: number,
  maxLineas: number,
  fuente: PDFFont,
): void {
  const todas = lineas.flatMap((l) => envolver(l, fuente, TAM, ancho));
  const visibles = todas.length > maxLineas ? todas.slice(0, maxLineas - 1) : todas;
  visibles.forEach((l, i) => izquierda(p, l, x, primeraBase + i * 8, { fuente }));
  if (todas.length > maxLineas) {
    izquierda(p, '… (continúa en el registro de GMT Link)', x, primeraBase + (maxLineas - 1) * 8, {
      fuente,
      color: GRIS_PIE,
    });
  }
}

async function dibujarFirma(
  doc: PDFDocument,
  p: PDFPage,
  datos: ChecklistFormatoData,
  fuente: PDFFont,
): Promise<void> {
  // Recuadro de la firma: entre el nombre del conductor y el rótulo FIRMA.
  const caja = { x: 106, arriba: 142, ancho: 121.6, alto: 30 };
  const centroX = caja.x + caja.ancho / 2;
  if (datos.firmaPng) {
    try {
      const img = await doc.embedPng(datos.firmaPng);
      const escala = Math.min(caja.ancho / img.width, caja.alto / img.height);
      const w = img.width * escala;
      const h = img.height * escala;
      p.drawImage(img, {
        x: centroX - w / 2,
        y: aPdf(caja.arriba + caja.alto / 2 + h / 2),
        width: w,
        height: h,
      });
      return;
    } catch {
      // Un PNG corrupto no puede impedir emitir el documento: se dice abajo.
    }
    centrado(p, 'No se pudo leer la firma', centroX, 160, { fuente, color: GRIS_PIE });
    return;
  }
  centrado(p, datos.firmaNota ?? 'Sin firma registrada', centroX, 160, {
    fuente,
    color: GRIS_PIE,
    tam: 5.5,
    max: 200,
  });
}

export async function composeChecklistFormatoPdf(datos: ChecklistFormatoData): Promise<Uint8Array> {
  const doc = await PDFDocument.load(Buffer.from(PLANTILLA_CHECKLIST_PDF_BASE64, 'base64'));
  doc.setTitle(`Checklist ${datos.vehiculo.patente} ${datos.fecha}`);
  doc.setProducer('GMT Link');
  const p = doc.getPage(0);
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── Cabecera ──
  izquierda(p, datos.proyecto, 108.4, 110.44, { fuente, max: 195 });
  centrado(p, datos.fecha, 484.6, 110.44, { fuente: negrita });

  // ── Datos del conductor ──
  centrado(p, datos.conductor, 206.05, 137.84, { fuente, max: 195 });
  await dibujarFirma(doc, p, datos, fuente);
  datos.datosConductor.slice(0, 2).forEach((lic, i) => {
    const arriba = CASILLAS_LICENCIA_Y[i] ?? 0;
    casilla(p, CASILLA_LICENCIA_X, arriba, lic.valor !== 'No registrada');
    const base = arriba + 5.3;
    const vencida = lic.valor.includes('VENCIDA');
    centrado(p, fechaDeFormato(lic.vencimiento), 265.75, base, {
      fuente,
      color: vencida ? ROJO : NEGRO,
    });
  });

  // ── Datos del vehículo ──
  const v = datos.vehiculo;
  izquierda(p, v.patente, 386.8, 133.14, { fuente, max: 110 });
  izquierda(p, v.kilometraje, 386.8, 142.24, { fuente, max: 110 });
  izquierda(p, v.proxMant, 386.8, 151.34, { fuente, max: 110 });
  for (const clave of ['permiso', 'revision', 'seguro', 'extintor'] as const) {
    const arriba = CASILLAS_VEHICULO[clave];
    casilla(p, CASILLA_VEHICULO_X, arriba, v[clave].presente);
    centrado(p, fechaDeFormato(v[clave].vencimiento), 544.3, arriba + 5.3, { fuente });
  }

  // ── Tablas ──
  const desbordes: string[] = [];
  dibujarTabla(
    p,
    FILAS_GENERAL,
    datos.estadoGeneral,
    BASE_GENERAL,
    COL_ESTADO_CENTRO,
    fuente,
    desbordes,
  );
  dibujarTabla(
    p,
    FILAS_EMERGENCIA,
    datos.equiposEmergencia,
    BASE_EMERGENCIA,
    COL_ESTADO_CENTRO,
    fuente,
    desbordes,
  );
  dibujarTabla(
    p,
    FILAS_CONDUCTOR,
    datos.condicionesConductor,
    BASE_CONDUCTOR,
    COL_RESPUESTA_CENTRO,
    fuente,
    desbordes,
  );

  // ── Observaciones de la carrocería: a la izquierda del dibujo ──
  bloqueTexto(p, datos.carroceria, 31.5, 603, 372, 9, fuente);

  // ── Observaciones generales: el texto, lo que no tuvo fila y lo desbordado ──
  const generales = [
    ...(datos.observaciones ? [datos.observaciones] : []),
    ...(datos.extras ?? []),
    ...desbordes,
  ];
  bloqueTexto(p, generales, 31.5, 702.5, 548, 5, fuente);

  // ── Pie, fuera del marco ──
  const avisos = datos.avisos ?? [];
  avisos.forEach((a, i) =>
    izquierda(p, a, 27.7, 750 + i * 7, { fuente, tam: 5.5, color: GRIS_PIE, max: 557 }),
  );

  return doc.save();
}
