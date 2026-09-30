import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib';
import { GMT_LOGO_JPEG_BASE64 } from './gmt-logo';

/**
 * PDF del REPORTE DE INCIDENTE con el formato GMT-SGC-SG-INC-FR-01.
 *
 * Reproduce el formulario que HSE ya usa en papel, hoja por hoja: mismos
 * bloques, mismas casillas, mismos colores y las mismas posiciones. Importa que
 * calce porque es el documento que se archiva y se muestra al mandante; uno con
 * otra disposición obliga a quien lo revisa a buscar cada dato en otro lugar.
 *
 * Las coordenadas salieron de medir el formulario original (el .xls exportado a
 * PDF por Excel, de 626,53 x 886,36 pt) y acá se escalan a A4 con `K`. Por eso
 * las constantes están en las unidades del original: comparar contra el formato
 * impreso es directo, sin recalcular nada.
 *
 * Módulo PURO: recibe los datos ya resueltos y devuelve los bytes. Nada de
 * Prisma ni de Nest, para poder probar la composición sin base de datos.
 */

// ── Escala del original a A4 ────────────────────────────────────────────────
const A4 = { ancho: 595.28, alto: 841.89 } as const;
/** El formato original mide 626,53 pt de ancho; esto lo lleva a A4. */
const K = A4.ancho / 626.53;

// ── Colores del formato ─────────────────────────────────────────────────────
const NEGRO = rgb(0, 0, 0);
/** Azul marino de los antecedentes, las acciones y los valores escritos. */
const NAVY = hex(0x000080);
/** Azul de los títulos de sección y de las consecuencias. */
const AZUL = hex(0x1f497d);
/** Azul más oscuro: título "Descripción del incidente" y la nota final. */
const AZUL_OSCURO = hex(0x003366);
const BORDE = rgb(0.1, 0.1, 0.1);

function hex(valor: number): RGB {
  return rgb(((valor >> 16) & 0xff) / 255, ((valor >> 8) & 0xff) / 255, (valor & 0xff) / 255);
}

// ── Marco del formulario (coordenadas del original) ─────────────────────────
const X_IZQ = 76.1;
const X_DER = 539.4;
/** Cabecera: logo | título | código. */
const CAB = { y0: 88.0, y1: 146.9, xLogo: 170.2, xCodigo: 428.0 } as const;
const ANTECEDENTES = { y0: 154.9, yTitulo: 172.3, y1: 235.4 } as const;
const CONSECUENCIAS = { y0: 237.9, yTitulo: 257.1 } as const;
const DESCRIPCION = { y0: 425.0, yTitulo: 450.9, y1: 551.6, xDiv: 352.5 } as const;
const ACCIONES = { y0: 553.0, yTitulo: 575.1, y1: 650.9 } as const;
const PREPARA = { y0: 652.6, ySep: 658.4, y1: 685.2, xDiv: 412.7 } as const;
const NOTA_Y = 693.8;

/** Columna de las casillas de consecuencia y de los recuadros de detalle. */
const CAJA = { xLabel0: 79.2, xLabel1: 216.2, xMarca0: 201.0, xDet0: 231.3, xDet1: 534.6 } as const;

/** Una fila de "Consecuencias": recuadro de la izquierda y de la derecha. */
interface FilaConsecuencia {
  etiqueta: string;
  /** Alto del recuadro izquierdo en el original. */
  y0: number;
  y1: number;
  /** Alto del recuadro derecho: la fuga ocupa dos líneas. */
  det0: number;
  det1: number;
  marcado: boolean;
}

// ── Tipos de entrada ────────────────────────────────────────────────────────

/** Una foto del incidente, ya leída del storage. */
export interface FotoIncidente {
  bytes: Uint8Array;
  /** `jpg` o `png`: decide con qué método la incrusta pdf-lib. */
  kind: 'jpg' | 'png';
}

/** Los datos del reporte, tal como los pide el formulario impreso. */
export interface DatosIncidente {
  code: string;
  empresa: string;
  sitio: string | null;
  area: string | null;
  turno: string | null;
  /** Día del incidente en formato chileno, d/m/aaaa. */
  fecha: string;
  hora: string;
  lesionPersonas: boolean;
  cargoLesionado: string | null;
  danoInfraestructura: boolean;
  danoDetalle: string | null;
  fugaDerrame: boolean;
  fugaSustancia: string | null;
  fugaDuracionMin: number | null;
  fugaVolumenM3: number | null;
  fugaPh: number | null;
  fugaSuperficieM2: number | null;
  emisionesAire: boolean;
  emisionGases: string | null;
  emisionDuracionMin: number | null;
  instalaciones: boolean;
  instalacionesLugar: string | null;
  cuasiAccidente: boolean;
  procesoAfectado: boolean;
  tiempoPerdido: 'CON' | 'SIN' | null;
  descripcion: string;
  /** Una acción por línea; el formato tiene cinco renglones. */
  accionesInmediatas: string;
  preparaNombre: string;
  preparaCargo: string | null;
  preparaFecha: string;
  /** La primera foto va en el recuadro "Imagen / Esquema / Plano". */
  foto: FotoIncidente | null;
}

// ── Helpers de dibujo (todos reciben coordenadas del original) ──────────────

/** Convierte una y del original (medida desde arriba) a la y de pdf-lib. */
function py(y: number): number {
  return A4.alto - y * K;
}

function px(x: number): number {
  return x * K;
}

function linea(page: PDFPage, x0: number, y: number, x1: number, grosor = 0.6): void {
  page.drawLine({
    start: { x: px(x0), y: py(y) },
    end: { x: px(x1), y: py(y) },
    thickness: grosor,
    color: BORDE,
  });
}

function vertical(page: PDFPage, x: number, y0: number, y1: number, grosor = 0.6): void {
  page.drawLine({
    start: { x: px(x), y: py(y0) },
    end: { x: px(x), y: py(y1) },
    thickness: grosor,
    color: BORDE,
  });
}

function caja(page: PDFPage, x0: number, y0: number, x1: number, y1: number, grosor = 0.6): void {
  linea(page, x0, y0, x1, grosor);
  linea(page, x0, y1, x1, grosor);
  vertical(page, x0, y0, y1, grosor);
  vertical(page, x1, y0, y1, grosor);
}

/**
 * Quita lo que la fuente estándar (WinAnsi) no sabe dibujar. Sin esto, un emoji
 * o una comilla tipográfica pegada desde el celular hace fallar el PDF entero.
 */
function limpiar(texto: string): string {
  return (
    texto
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\u0000-ÿ]/g, '')
  );
}

interface OpcionesTexto {
  font: PDFFont;
  /** Tamaño en puntos del original. */
  size: number;
  color: RGB;
  /** Ancho máximo (en unidades del original) antes de achicar la letra. */
  maxAncho?: number;
}

/**
 * Escribe en la línea base indicada. Si el texto no cabe en `maxAncho` se achica
 * hasta un 70%: el formato es fijo y es preferible una palabra más chica que
 * una que se monte sobre la casilla siguiente.
 */
function texto(page: PDFPage, valor: string, x: number, base: number, o: OpcionesTexto): void {
  const limpio = limpiar(valor);
  if (!limpio) return;
  let size = o.size * K;
  if (o.maxAncho) {
    const limite = o.maxAncho * K;
    const ancho = o.font.widthOfTextAtSize(limpio, size);
    if (ancho > limite) size = Math.max(size * 0.7, (size * limite) / ancho);
  }
  page.drawText(limpio, { x: px(x), y: py(base), size, font: o.font, color: o.color });
}

/** Igual que `texto`, centrado entre dos x del original. */
function centrado(
  page: PDFPage,
  valor: string,
  x0: number,
  x1: number,
  base: number,
  o: OpcionesTexto,
): void {
  const limpio = limpiar(valor);
  if (!limpio) return;
  const size = o.size * K;
  const ancho = o.font.widthOfTextAtSize(limpio, size);
  const centro = (px(x0) + px(x1)) / 2 - ancho / 2;
  page.drawText(limpio, { x: centro, y: py(base), size, font: o.font, color: o.color });
}

/** Parte un texto en líneas que quepan en `maxAncho` (unidades del original). */
function enLineas(valor: string, font: PDFFont, size: number, maxAncho: number): string[] {
  const limite = maxAncho * K;
  const lineas: string[] = [];
  for (const parrafo of limpiar(valor).split(/\r?\n/)) {
    let actual = '';
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = actual ? `${actual} ${palabra}` : palabra;
      if (font.widthOfTextAtSize(tentativa, size * K) <= limite) {
        actual = tentativa;
      } else {
        if (actual) lineas.push(actual);
        actual = palabra;
      }
    }
    lineas.push(actual);
  }
  return lineas;
}

/** Texto de un número opcional, sin decimales de más. */
function numero(v: number | null): string {
  return v === null || v === undefined ? '' : String(v);
}

// ── El formato ──────────────────────────────────────────────────────────────

export async function buildIncidentePdf(datos: DatosIncidente): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Reporte de incidente ${datos.code}`);
  doc.setCreator('GMT Link');
  const page = doc.addPage([A4.ancho, A4.alto]);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);

  // ── Cabecera: logo | REPORTE DE INCIDENTE | código ──
  caja(page, X_IZQ, CAB.y0, X_DER, CAB.y1);
  vertical(page, CAB.xLogo, CAB.y0, CAB.y1);
  vertical(page, CAB.xCodigo, CAB.y0, CAB.y1);

  const logo = await doc.embedJpg(Buffer.from(GMT_LOGO_JPEG_BASE64, 'base64'));
  const anchoLogo = 86.8 * K;
  const altoLogo = (anchoLogo * logo.height) / logo.width;
  page.drawImage(logo, {
    x: px(77.4),
    y: py(104.0) - altoLogo,
    width: anchoLogo,
    height: altoLogo,
  });

  centrado(page, 'REPORTE DE INCIDENTE', CAB.xLogo, CAB.xCodigo, 121.0, {
    font: negrita,
    size: 11,
    color: NEGRO,
  });
  const codigo = ['Codigo: GMT-SGC-SG-INC-FR-01', 'Fecha emision: 10-07-2026', 'Rev:01'];
  codigo.forEach((linea, i) => {
    centrado(page, linea, CAB.xCodigo, X_DER, 110.1 + i * 9.35, {
      font: negrita,
      size: 6.9,
      color: NEGRO,
    });
  });

  // ── Antecedentes Generales ──
  caja(page, X_IZQ, ANTECEDENTES.y0, X_DER, ANTECEDENTES.y1);
  linea(page, X_IZQ, ANTECEDENTES.yTitulo, X_DER);
  centrado(page, 'Antecedentes Generales', X_IZQ, X_DER, 167.5, {
    font: negrita,
    size: 10,
    color: AZUL,
  });

  // El formato original usa Arial Narrow y acá se dibuja con Helvetica, que es
  // más ancha: sin este tope, "Empresa" y "Registro" se montan sobre su valor.
  const etiqueta = { font: normal, size: 9, color: NAVY, maxAncho: 31 } as const;
  const etiquetaDer = { ...etiqueta, maxAncho: 27 } as const;
  const valor = { font: normal, size: 9, color: NAVY } as const;
  texto(page, 'Empresa', 76.7, 190.1, etiqueta);
  texto(page, datos.empresa, 111.1, 190.1, { ...valor, maxAncho: 178 });
  linea(page, 109.5, 193.5, 291.6, 0.5);
  texto(page, 'Sitio', 308.1, 190.1, etiquetaDer);
  texto(page, datos.sitio ?? '', 338.5, 190.1, { ...valor, maxAncho: 194 });
  linea(page, 337.0, 193.5, 534.2, 0.5);

  texto(page, 'Fecha', 76.7, 211.1, etiqueta);
  texto(page, datos.fecha, 111.1, 211.1, { ...valor, maxAncho: 72 });
  linea(page, 109.5, 214.5, 185.5, 0.5);
  texto(page, 'Hora', 202.0, 211.1, etiqueta);
  texto(page, datos.hora, 232.3, 211.1, { ...valor, maxAncho: 57 });
  linea(page, 230.8, 214.5, 291.6, 0.5);
  texto(page, 'Area', 308.1, 211.1, etiquetaDer);
  texto(page, datos.area ?? '', 338.5, 211.1, { ...valor, maxAncho: 194 });
  linea(page, 337.0, 214.5, 534.2, 0.5);

  texto(page, 'Turno', 76.7, 226.4, etiqueta);
  texto(page, datos.turno ?? '', 111.1, 226.4, { ...valor, maxAncho: 72 });
  linea(page, 109.5, 229.8, 185.5, 0.5);
  texto(page, 'Registro', 308.1, 226.4, etiquetaDer);
  texto(page, datos.code, 338.5, 226.4, { ...valor, maxAncho: 194 });
  linea(page, 337.0, 229.8, 534.2, 0.5);

  // ── Consecuencias ──
  linea(page, X_IZQ, CONSECUENCIAS.y0, X_DER);
  linea(page, X_IZQ, CONSECUENCIAS.yTitulo, X_DER);
  vertical(page, X_IZQ, CONSECUENCIAS.y0, DESCRIPCION.y0);
  vertical(page, X_DER, CONSECUENCIAS.y0, DESCRIPCION.y0);
  linea(page, X_IZQ, DESCRIPCION.y0, X_DER);
  centrado(page, 'Consecuencias', X_IZQ, X_DER, 250.5, {
    font: negrita,
    size: 10,
    color: AZUL,
  });

  const filas: FilaConsecuencia[] = [
    {
      etiqueta: 'Lesión a Personas',
      y0: 260.1,
      y1: 278.2,
      det0: 260.1,
      det1: 278.2,
      marcado: datos.lesionPersonas,
    },
    {
      etiqueta: 'Daño a Infraestructura / Equipo',
      y0: 282.5,
      y1: 300.5,
      det0: 282.5,
      det1: 300.5,
      marcado: datos.danoInfraestructura,
    },
    {
      etiqueta: 'Fuga / Derrame',
      y0: 304.8,
      y1: 322.9,
      det0: 304.8,
      det1: 341.0,
      marcado: datos.fugaDerrame,
    },
    {
      etiqueta: 'Emisiones al aire',
      y0: 345.3,
      y1: 363.3,
      det0: 345.3,
      det1: 363.3,
      marcado: datos.emisionesAire,
    },
    {
      etiqueta: 'Instalaciones (robos, hurtos)',
      y0: 367.6,
      y1: 382.2,
      det0: 367.6,
      det1: 382.2,
      marcado: datos.instalaciones,
    },
    {
      etiqueta: 'Cuasi Accidente',
      y0: 386.1,
      y1: 400.6,
      det0: 386.1,
      det1: 400.6,
      marcado: datos.cuasiAccidente,
    },
    {
      etiqueta: 'Proceso o área afectado',
      y0: 404.1,
      y1: 418.7,
      det0: 404.1,
      det1: 418.7,
      marcado: datos.procesoAfectado,
    },
  ];

  for (const fila of filas) {
    caja(page, CAJA.xLabel0, fila.y0, CAJA.xLabel1, fila.y1);
    vertical(page, CAJA.xMarca0, fila.y0, fila.y1);
    caja(page, CAJA.xDet0, fila.det0, CAJA.xDet1, fila.det1);
    texto(page, fila.etiqueta, 80.7, fila.y1 - 3.0, {
      font: normal,
      size: 9,
      color: AZUL,
      maxAncho: 118,
    });
    if (fila.marcado) {
      centrado(page, 'X', CAJA.xMarca0, CAJA.xLabel1, fila.y1 - 3.0, {
        font: normal,
        size: 9,
        color: AZUL,
      });
    }
  }

  const rotulo = { font: normal, size: 8, color: AZUL } as const;
  const dato = { font: normal, size: 9, color: NAVY } as const;

  texto(page, 'Cargo del lesionado:', 232.3, 275.2, rotulo);
  texto(page, datos.cargoLesionado ?? '', 310.0, 275.2, { ...dato, maxAncho: 218 });
  texto(page, 'Especifique:', 232.3, 297.5, rotulo);
  texto(page, datos.danoDetalle ?? '', 280.0, 297.5, { ...dato, maxAncho: 248 });

  texto(page, 'Sustancia', 232.3, 319.9, rotulo);
  texto(page, datos.fugaSustancia ?? '', 270.0, 319.9, { ...dato, maxAncho: 168 });
  texto(page, 'Duración (minutos)', 444.6, 319.9, rotulo);
  texto(page, numero(datos.fugaDuracionMin), 508.0, 319.9, { ...dato, maxAncho: 24 });
  texto(page, 'Volumen derramado (m3)', 232.3, 337.9, rotulo);
  texto(page, numero(datos.fugaVolumenM3), 320.0, 337.9, { ...dato, maxAncho: 58 });
  texto(page, 'pH', 384.0, 337.9, rotulo);
  texto(page, numero(datos.fugaPh), 396.0, 337.9, { ...dato, maxAncho: 42 });
  texto(page, 'Superfície (m2)', 444.6, 337.9, rotulo);
  texto(page, numero(datos.fugaSuperficieM2), 500.0, 337.9, { ...dato, maxAncho: 32 });

  texto(page, 'Gases', 232.3, 360.3, rotulo);
  texto(page, datos.emisionGases ?? '', 262.1, 360.3, { ...dato, maxAncho: 110 });
  linea(page, 262.1, 362.7, 299.0, 0.8);
  texto(page, 'Duración (minutos)', 429.5, 360.3, rotulo);
  texto(page, numero(datos.emisionDuracionMin), 498.0, 360.3, { ...dato, maxAncho: 33 });
  linea(page, 497.4, 363.5, 532.3, 0.8);

  texto(page, 'Lugar específico:', 232.3, 378.6, rotulo);
  texto(page, datos.instalacionesLugar ?? '', 294.0, 378.6, { ...dato, maxAncho: 234 });

  texto(page, 'Con tiempo perdido:', 232.3, 396.5, { font: normal, size: 9, color: AZUL });
  if (datos.tiempoPerdido === 'CON') {
    texto(page, 'X', 323.3, 396.5, { font: normal, size: 9, color: AZUL });
  }
  texto(page, 'Sin tiempo perdido:', 232.3, 414.6, { font: normal, size: 9, color: AZUL });
  if (datos.tiempoPerdido === 'SIN') {
    texto(page, 'X', 323.3, 414.6, { font: normal, size: 9, color: AZUL });
  }

  // ── Descripción del incidente + imagen ──
  caja(page, X_IZQ, DESCRIPCION.y0, X_DER, DESCRIPCION.y1);
  linea(page, X_IZQ, DESCRIPCION.yTitulo, X_DER);
  vertical(page, DESCRIPCION.xDiv, DESCRIPCION.y0, DESCRIPCION.y1);
  centrado(page, 'Descripción del incidente', X_IZQ, DESCRIPCION.xDiv, 438.8, {
    font: negrita,
    size: 10,
    color: AZUL_OSCURO,
  });
  centrado(page, '(breve, certera, sin suposiciones)', X_IZQ, DESCRIPCION.xDiv, 449.3, {
    font: negrita,
    size: 8,
    color: AZUL_OSCURO,
  });
  centrado(page, 'Imagen / Esquema / Plano', DESCRIPCION.xDiv, X_DER, 443.9, {
    font: negrita,
    size: 10,
    color: AZUL,
  });

  const lineasDesc = enLineas(datos.descripcion, normal, 8, 268);
  const MAX_LINEAS_DESC = 9;
  lineasDesc.slice(0, MAX_LINEAS_DESC).forEach((l, i) => {
    texto(page, l, 76.7, 459.8 + i * 10.2, { font: normal, size: 8, color: AZUL });
  });

  if (datos.foto) {
    const imagen: PDFImage =
      datos.foto.kind === 'jpg'
        ? await doc.embedJpg(datos.foto.bytes)
        : await doc.embedPng(datos.foto.bytes);
    const marco = { x0: 355.0, y0: 454.5, x1: 537.0, y1: 549.0 };
    const anchoMax = (marco.x1 - marco.x0) * K;
    const altoMax = (marco.y1 - marco.y0) * K;
    const escala = Math.min(anchoMax / imagen.width, altoMax / imagen.height);
    const w = imagen.width * escala;
    const h = imagen.height * escala;
    page.drawImage(imagen, {
      x: (px(marco.x0) + px(marco.x1)) / 2 - w / 2,
      y: (py(marco.y1) + py(marco.y0)) / 2 - h / 2,
      width: w,
      height: h,
    });
  }

  // ── Acciones Inmediatas Adoptadas ──
  caja(page, X_IZQ, ACCIONES.y0, X_DER, ACCIONES.y1);
  linea(page, X_IZQ, ACCIONES.yTitulo, X_DER);
  centrado(page, 'Acciones Inmediatas Adoptadas', X_IZQ, X_DER, 569.2, {
    font: negrita,
    size: 10,
    color: AZUL,
  });
  const acciones = enLineas(datos.accionesInmediatas, normal, 9, 455);
  acciones.slice(0, 5).forEach((l, i) => {
    texto(page, l, 76.7, 586.4 + i * 15.2, { font: normal, size: 9, color: NAVY });
  });

  // ── Prepara / Fecha ──
  caja(page, X_IZQ, PREPARA.y0, X_DER, PREPARA.y1);
  linea(page, X_IZQ, PREPARA.ySep, X_DER);
  vertical(page, PREPARA.xDiv, PREPARA.y0, PREPARA.y1);
  texto(page, 'Prepara (nombre, cargo):', 76.7, 666.9, { font: negrita, size: 9, color: AZUL });
  texto(page, 'Fecha:', 414.3, 666.9, { font: negrita, size: 9, color: AZUL });
  const prepara = datos.preparaCargo
    ? `${datos.preparaNombre} ${datos.preparaCargo}`
    : datos.preparaNombre;
  texto(page, prepara, 76.7, 680.4, { font: normal, size: 9, color: NAVY, maxAncho: 330 });
  texto(page, datos.preparaFecha, 414.3, 680.4, {
    font: normal,
    size: 9,
    color: NAVY,
    maxAncho: 118,
  });

  // ── Nota al pie (fuera del marco, como en el original) ──
  centrado(
    page,
    'Este reporte debe ser preparado por el Jefe Directo del trabajador lesionado, equipo, propiedad, vehículo o material dañado',
    X_IZQ,
    X_DER,
    NOTA_Y + 7.4,
    { font: normal, size: 8, color: AZUL_OSCURO },
  );

  return Buffer.from(await doc.save());
}
