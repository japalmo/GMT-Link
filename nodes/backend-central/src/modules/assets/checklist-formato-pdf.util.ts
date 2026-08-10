import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';

/**
 * PDF del checklist de vehículo con el FORMATO REAL de GMT.
 *
 * Reproduce la pestaña "FORMATO CHECKLIST" del libro que la flota usa hoy: el
 * mismo orden, los mismos títulos y los mismos colores. Importa que calce,
 * porque es el documento que se firma y se archiva; uno con otra disposición
 * obliga a quien lo revisa a buscar cada dato en un lugar distinto al que
 * conoce.
 *
 * El molde impreso, fila por fila:
 *
 *   1   CHECKLIST DE VEHICULOS LIVIANOS
 *   6   PROYECTO | FECHA
 *   8   DATOS DEL CONDUCTOR | DATOS DEL VEHÍCULO
 *   17  ESTADO GENERAL DEL VEHÍCULO      (navy, 21 ítems)
 *   40  EQUIPOS DE EMERGENCIA            (navy, 11 ítems)
 *   53  CONDICIONES DEL CONDUCTOR        (navy, 4 preguntas)
 *   59  OBSERVACIONES DE LA CARROCERÍA   (navy, diagrama)
 *   70  OBSERVACIONES GENERALES          (navy, texto libre)
 *
 * Módulo PURO: recibe los datos ya resueltos y devuelve los bytes. Nada de
 * Prisma ni de Nest, para poder probar la composición sin base de datos.
 */

// ── Colores del molde ───────────────────────────────────────────────────────
/** Navy de GMT: los títulos de sección del formato original. */
const NAVY = rgb(0x26 / 255, 0x32 / 255, 0x6b / 255);
/** Gris de las cabeceras de columna (ITEM / ESTADO / OBSERVACIONES). */
const GRIS_CABECERA = rgb(0x66 / 255, 0x66 / 255, 0x66 / 255);
/** Gris de las celdas de etiqueta. */
const GRIS_ETIQUETA = rgb(0xd9 / 255, 0xd9 / 255, 0xd9 / 255);
/** Gris claro de las celdas de valor. */
const GRIS_VALOR = rgb(0xf3 / 255, 0xf3 / 255, 0xf3 / 255);
/** Gris de los bloques de datos de cabecera. */
const GRIS_DATOS = rgb(0xef / 255, 0xef / 255, 0xef / 255);
const NEGRO = rgb(0.1, 0.1, 0.1);
const BLANCO = rgb(1, 1, 1);
const BORDE = rgb(0.72, 0.72, 0.72);
/** Rojo para las respuestas que cuentan como falla. */
const ROJO = rgb(0.72, 0.11, 0.11);

const A4 = { ancho: 595.28, alto: 841.89 } as const;
const MARGEN = 34;
const ALTO_FILA = 15;
const TAM = 7.5;

/** Un ítem con su respuesta, listo para dibujar en una tabla del formato. */
export interface FilaFormato {
  etiqueta: string;
  valor: string;
  observacion?: string;
  /** Se pinta en rojo: el motor la considera falla. */
  esFalla?: boolean;
}

/** Un par etiqueta/valor de los bloques de datos de la cabecera. */
export interface DatoCabecera {
  etiqueta: string;
  valor: string;
  /** Vencimiento, cuando el dato es un documento. */
  vencimiento?: string;
}

export interface ChecklistFormatoData {
  proyecto: string;
  fecha: string;
  /** Nombre de quien llenó el checklist. */
  conductor: string;
  /**
   * Se muestra cuando el checklist NO se hizo en la plataforma. El documento
   * tiene que decirlo: el nombre viene de la planilla y nadie lo firmó acá.
   */
  origenExterno?: string;
  datosConductor: readonly DatoCabecera[];
  datosVehiculo: readonly DatoCabecera[];
  estadoGeneral: readonly FilaFormato[];
  equiposEmergencia: readonly FilaFormato[];
  condicionesConductor: readonly FilaFormato[];
  /** Una línea por parte marcada del diagrama. */
  carroceria: readonly string[];
  observaciones: string;
}

/** Estado de dibujo: página actual y cursor vertical. */
interface Lienzo {
  doc: PDFDocument;
  pagina: PDFPage;
  y: number;
  fuente: PDFFont;
  negrita: PDFFont;
}

/** Ancho utilizable entre márgenes. */
const ANCHO = A4.ancho - MARGEN * 2;

/** Corta un texto para que quepa en `max` puntos, con puntos suspensivos. */
function recortar(texto: string, fuente: PDFFont, tam: number, max: number): string {
  if (fuente.widthOfTextAtSize(texto, tam) <= max) return texto;
  let t = texto;
  while (t.length > 1 && fuente.widthOfTextAtSize(`${t}…`, tam) > max) {
    t = t.slice(0, -1);
  }
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

/** Abre una página nueva cuando lo que viene no cabe. */
function asegurarEspacio(l: Lienzo, alto: number): void {
  if (l.y - alto >= MARGEN) return;
  l.pagina = l.doc.addPage([A4.ancho, A4.alto]);
  l.y = A4.alto - MARGEN;
}

/** Barra de título de sección: navy con el texto en blanco. */
function seccion(l: Lienzo, titulo: string): void {
  asegurarEspacio(l, ALTO_FILA * 3);
  l.y -= 8;
  l.pagina.drawRectangle({ x: MARGEN, y: l.y - ALTO_FILA, width: ANCHO, height: ALTO_FILA, color: NAVY });
  l.pagina.drawText(titulo, {
    x: MARGEN + 5,
    y: l.y - ALTO_FILA + 4.5,
    size: TAM + 0.5,
    font: l.negrita,
    color: BLANCO,
  });
  l.y -= ALTO_FILA;
}

/** Celda con fondo, borde y texto. `alto` permite filas de varias líneas. */
function celda(
  l: Lienzo,
  x: number,
  ancho: number,
  texto: string,
  opciones: {
    fondo?: RGB;
    negrita?: boolean;
    color?: RGB;
    centrado?: boolean;
    alto?: number;
    lineas?: readonly string[];
  } = {},
): void {
  const alto = opciones.alto ?? ALTO_FILA;
  if (opciones.fondo) {
    l.pagina.drawRectangle({ x, y: l.y - alto, width: ancho, height: alto, color: opciones.fondo });
  }
  l.pagina.drawRectangle({
    x,
    y: l.y - alto,
    width: ancho,
    height: alto,
    borderColor: BORDE,
    borderWidth: 0.4,
  });
  const fuente = opciones.negrita ? l.negrita : l.fuente;

  // Con varias líneas se dibuja desde arriba; con una sola se centra vertical,
  // que es como se ve el molde cuando el texto es corto.
  if (opciones.lineas && opciones.lineas.length > 1) {
    opciones.lineas.forEach((linea, i) => {
      l.pagina.drawText(linea, {
        x: x + 4,
        y: l.y - 10 - i * 9,
        size: TAM,
        font: fuente,
        color: opciones.color ?? NEGRO,
      });
    });
    return;
  }

  const unaLinea = opciones.lineas?.[0] ?? texto;
  const recortado = recortar(unaLinea, fuente, TAM, ancho - 8);
  const dx = opciones.centrado
    ? (ancho - fuente.widthOfTextAtSize(recortado, TAM)) / 2
    : 4;
  l.pagina.drawText(recortado, {
    x: x + dx,
    y: l.y - alto / 2 - 2.5,
    size: TAM,
    font: fuente,
    color: opciones.color ?? NEGRO,
  });
}

/** Cabecera de columnas ITEM / ESTADO / OBSERVACIONES. */
function cabeceraTabla(l: Lienzo, titulos: readonly [string, string, string], anchos: readonly number[]): void {
  asegurarEspacio(l, ALTO_FILA * 2);
  let x = MARGEN;
  titulos.forEach((t, i) => {
    celda(l, x, anchos[i]!, t, { fondo: GRIS_CABECERA, negrita: true, color: BLANCO });
    x += anchos[i]!;
  });
  l.y -= ALTO_FILA;
}

/** Tabla de ítems del formato: etiqueta, estado y observación. */
function tablaItems(l: Lienzo, filas: readonly FilaFormato[], titulos: readonly [string, string, string]): void {
  // Proporciones del molde: la etiqueta ocupa poco más de la mitad.
  const anchos = [ANCHO * 0.52, ANCHO * 0.14, ANCHO * 0.34];
  cabeceraTabla(l, titulos, anchos);

  for (const f of filas) {
    // La observación se ENVUELVE, no se recorta: en un documento que se firma,
    // perder la mitad de "vibración de motor a partir de 50 km/h" deja el
    // registro peor que vacío, porque parece completo y no lo está.
    const obs = f.observacion ?? '';
    const lineasObs = obs ? envolver(obs, l.fuente, TAM, anchos[2]! - 8) : [''];
    const lineasEtiqueta = envolver(f.etiqueta, l.fuente, TAM, anchos[0]! - 8);
    const nLineas = Math.max(lineasObs.length, lineasEtiqueta.length);
    const alto = nLineas > 1 ? nLineas * 9 + 6 : ALTO_FILA;

    asegurarEspacio(l, alto);
    // Si la página cambió, se repite la cabecera para no dejar filas huérfanas.
    if (l.y === A4.alto - MARGEN) cabeceraTabla(l, titulos, anchos);

    celda(l, MARGEN, anchos[0]!, f.etiqueta, {
      fondo: GRIS_ETIQUETA,
      alto,
      lineas: lineasEtiqueta,
    });
    celda(l, MARGEN + anchos[0]!, anchos[1]!, f.valor, {
      fondo: GRIS_VALOR,
      centrado: true,
      alto,
      negrita: f.esFalla === true,
      color: f.esFalla === true ? ROJO : NEGRO,
    });
    celda(l, MARGEN + anchos[0]! + anchos[1]!, anchos[2]!, obs, {
      fondo: GRIS_VALOR,
      alto,
      lineas: lineasObs,
    });
    l.y -= alto;
  }
}

/** Bloque de datos de la cabecera (conductor / vehículo), en una columna. */
function bloqueDatos(
  l: Lienzo,
  x: number,
  ancho: number,
  titulo: string,
  datos: readonly DatoCabecera[],
  yInicial: number,
): number {
  let y = yInicial;
  const dibujar = (yy: number, cb: (l2: Lienzo) => void): void => {
    const previo = l.y;
    l.y = yy;
    cb(l);
    l.y = previo;
  };

  dibujar(y, (l2) => {
    celda(l2, x, ancho, titulo, { fondo: rgb(0.8, 0.8, 0.8), negrita: true });
  });
  y -= ALTO_FILA;

  const anchoEtiqueta = ancho * 0.42;
  const anchoValor = ancho - anchoEtiqueta;
  for (const d of datos) {
    const valor = d.vencimiento ? `${d.valor}  ·  vence ${d.vencimiento}` : d.valor;
    dibujar(y, (l2) => {
      celda(l2, x, anchoEtiqueta, d.etiqueta, { fondo: GRIS_DATOS });
      celda(l2, x + anchoEtiqueta, anchoValor, valor, { fondo: GRIS_DATOS });
    });
    y -= ALTO_FILA;
  }
  return y;
}

/** Bloque de texto libre con fondo, para las observaciones. */
function bloqueTexto(l: Lienzo, texto: string): void {
  const lineas = envolver(texto || 'Sin observaciones.', l.fuente, TAM, ANCHO - 10);
  const alto = Math.max(ALTO_FILA, lineas.length * 10 + 6);
  asegurarEspacio(l, alto);
  l.pagina.drawRectangle({
    x: MARGEN,
    y: l.y - alto,
    width: ANCHO,
    height: alto,
    color: GRIS_VALOR,
    borderColor: BORDE,
    borderWidth: 0.4,
  });
  lineas.forEach((linea, i) => {
    l.pagina.drawText(linea, {
      x: MARGEN + 5,
      y: l.y - 11 - i * 10,
      size: TAM,
      font: l.fuente,
      color: NEGRO,
    });
  });
  l.y -= alto;
}

/**
 * Compone el PDF del checklist con el formato real. Devuelve los bytes.
 */
export async function composeChecklistFormatoPdf(
  data: ChecklistFormatoData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const pagina = doc.addPage([A4.ancho, A4.alto]);
  const l: Lienzo = { doc, pagina, y: A4.alto - MARGEN, fuente, negrita };

  // ── Título ──
  const titulo = 'CHECKLIST DE VEHÍCULOS LIVIANOS';
  l.pagina.drawText(titulo, {
    x: (A4.ancho - negrita.widthOfTextAtSize(titulo, 13)) / 2,
    y: l.y - 12,
    size: 13,
    font: negrita,
    color: NAVY,
  });
  l.y -= 26;

  // ── Proyecto y fecha ──
  const mitad = ANCHO / 2;
  celda(l, MARGEN, mitad * 0.35, 'PROYECTO:', { fondo: GRIS_DATOS, negrita: true });
  celda(l, MARGEN + mitad * 0.35, mitad * 0.65, data.proyecto, { fondo: GRIS_DATOS });
  celda(l, MARGEN + mitad, mitad * 0.3, 'FECHA:', { fondo: GRIS_DATOS, negrita: true });
  celda(l, MARGEN + mitad + mitad * 0.3, mitad * 0.7, data.fecha, { fondo: GRIS_DATOS });
  l.y -= ALTO_FILA + 8;

  // ── Datos del conductor | Datos del vehículo, lado a lado ──
  const anchoBloque = ANCHO / 2 - 5;
  const yBloques = l.y;
  const yIzq = bloqueDatos(
    l,
    MARGEN,
    anchoBloque,
    'DATOS DEL CONDUCTOR',
    [{ etiqueta: 'Nombre del conductor:', valor: data.conductor }, ...data.datosConductor],
    yBloques,
  );
  const yDer = bloqueDatos(
    l,
    MARGEN + anchoBloque + 10,
    anchoBloque,
    'DATOS DEL VEHÍCULO',
    data.datosVehiculo,
    yBloques,
  );
  l.y = Math.min(yIzq, yDer);

  // El origen externo va bajo los bloques y NO como un dato más: no es un
  // atributo del conductor, es una advertencia sobre el documento entero.
  if (data.origenExterno) {
    l.y -= 4;
    asegurarEspacio(l, ALTO_FILA);
    celda(l, MARGEN, ANCHO, data.origenExterno, { fondo: rgb(1, 0.96, 0.85) });
    l.y -= ALTO_FILA;
  }

  // ── Las tres tablas del molde ──
  seccion(l, 'ESTADO GENERAL DEL VEHÍCULO');
  tablaItems(l, data.estadoGeneral, ['ITEM', 'ESTADO', 'OBSERVACIONES']);

  seccion(l, 'EQUIPOS DE EMERGENCIA');
  tablaItems(l, data.equiposEmergencia, ['ITEM', 'ESTADO', 'OBSERVACIONES']);

  seccion(l, 'CONDICIONES DEL CONDUCTOR');
  tablaItems(l, data.condicionesConductor, ['PREGUNTA', 'RESPUESTA', 'OBSERVACIONES']);

  // ── Carrocería ──
  seccion(l, 'OBSERVACIONES DE LA CARROCERÍA (ralladuras, abolladuras, etc.)');
  bloqueTexto(
    l,
    data.carroceria.length > 0
      ? data.carroceria.map((c) => `• ${c}`).join('\n')
      : 'Sin observaciones de carrocería.',
  );

  // ── Observaciones generales ──
  seccion(l, 'OBSERVACIONES GENERALES');
  bloqueTexto(l, data.observaciones);

  return doc.save();
}
