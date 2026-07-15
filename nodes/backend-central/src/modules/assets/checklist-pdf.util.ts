import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';

/** Un ítem de la plantilla con su respuesta ya resuelta, listo para dibujar. */
export interface ChecklistPdfRow {
  label: string;
  valueLabel: string;
  comment?: string;
  /**
   * Líneas de detalle adicionales bajo la fila (sin el prefijo "Comentario:").
   * Se usa para expandir el valor de un ítem SVG a líneas `parte: comentario`.
   */
  details?: readonly string[];
}

/** Resumen de un valor de respuesta SVG: contador + líneas `parte: comentario`. */
export interface SvgAnswerSummary {
  /** Etiqueta corta para la columna "Respuesta" (p. ej. "2 observaciones"). */
  summary: string;
  /** Una línea `parte: comentario` por cada parte con observación. */
  lines: string[];
}

/**
 * Interpreta el valor de una respuesta de ítem SVG (diagrama de carrocería). El
 * valor es un JSON string del mapa `{ [partId]: { part, comment } }`. Devuelve un
 * resumen legible (`"N observaciones"` + líneas `parte: comentario`) o `null` si el
 * valor no parsea a ese mapa (para que el llamador lo formatee como un valor común).
 *
 * Robusto: no lanza. Si el valor no es un string, no parsea, o no tiene la forma
 * del mapa (algún elemento no es un objeto), devuelve `null` (déjalo como está).
 */
export function formatSvgAnswerValue(value: unknown): SvgAnswerSummary | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const lines: string[] = [];
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    // Cualquier elemento que no sea un objeto delata que NO es el mapa de partes:
    // se descarta el valor completo para no confundir un texto JSON cualquiera.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    const comment = typeof entry.comment === 'string' ? entry.comment.trim() : '';
    if (comment === '') continue;
    const part = typeof entry.part === 'string' && entry.part.trim() ? entry.part.trim() : key;
    lines.push(`${part}: ${comment}`);
  }

  const count = lines.length;
  const summary =
    count === 0 ? 'Sin observaciones' : `${count} ${count === 1 ? 'observación' : 'observaciones'}`;
  return { summary, lines };
}

/** Datos de cabecera + filas para componer el PDF de una submission. */
export interface ChecklistPdfData {
  assetCode: string;
  assetName: string;
  templateName: string;
  submittedBy: string;
  submittedAt: string; // etiqueta ya formateada
  rows: readonly ChecklistPdfRow[];
}

/** Dimensiones A4 vertical en puntos. */
const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 40;
const LINE_GAP = 6;

/**
 * Compone un PDF (A4 vertical) con la cabecera del checklist y una tabla de
 * ítem/respuesta/comentario. Pagina automáticamente cuando el contenido excede
 * la página. Devuelve los bytes del PDF.
 */
export async function composeChecklistPdf(data: ChecklistPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const usableW = A4.width - MARGIN * 2;
  let page = doc.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const newPage = (): void => {
    page = doc.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN;
  };

  const ensureSpace = (needed: number): void => {
    if (y - needed < MARGIN) {
      newPage();
    }
  };

  // ---- Cabecera ----
  page.drawText('Checklist ejecutado', {
    x: MARGIN,
    y: y - 18,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 34;

  const headerLines = [
    `Activo: ${data.assetName} (${data.assetCode})`,
    `Plantilla: ${data.templateName}`,
    `Ejecutado por: ${data.submittedBy}`,
    `Fecha: ${data.submittedAt}`,
  ];
  for (const line of headerLines) {
    page.drawText(truncate(line, font, 10, usableW), {
      x: MARGIN,
      y: y - 10,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 15;
  }

  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.75,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 16;

  // ---- Encabezado de tabla ----
  const colItemX = MARGIN;
  const colValueX = MARGIN + usableW * 0.62;
  page.drawText('Ítem', { x: colItemX, y: y - 9, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Respuesta', { x: colValueX, y: y - 9, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 18;

  const itemColW = colValueX - colItemX - 8;
  const valueColW = A4.width - MARGIN - colValueX;

  if (data.rows.length === 0) {
    page.drawText('La plantilla no tiene ítems.', {
      x: MARGIN,
      y: y - 10,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    return doc.save();
  }

  for (const row of data.rows) {
    const labelLines = wrap(row.label, font, 9, itemColW);
    const valueLines = wrap(row.valueLabel || '-', font, 9, valueColW);
    const commentLines = row.comment ? wrap(`Comentario: ${row.comment}`, font, 8, usableW) : [];
    // Detalle (p. ej. líneas `parte: comentario` de un ítem SVG): cada entrada se
    // ajusta al ancho útil, indentada bajo la fila.
    const detailLines = (row.details ?? []).flatMap((detail) => wrap(detail, font, 8, usableW - 8));
    const rowLines = Math.max(labelLines.length, valueLines.length);
    const extraLines = commentLines.length + detailLines.length;
    const rowHeight = rowLines * (9 + LINE_GAP) + (extraLines > 0 ? extraLines * (8 + 2) + 4 : 0) + 6;

    ensureSpace(rowHeight);

    let lineY = y;
    for (let i = 0; i < rowLines; i += 1) {
      if (labelLines[i]) {
        page.drawText(labelLines[i] as string, { x: colItemX, y: lineY - 9, size: 9, font, color: rgb(0.15, 0.15, 0.15) });
      }
      if (valueLines[i]) {
        page.drawText(valueLines[i] as string, { x: colValueX, y: lineY - 9, size: 9, font, color: rgb(0.15, 0.15, 0.15) });
      }
      lineY -= 9 + LINE_GAP;
    }

    for (const cline of commentLines) {
      page.drawText(cline, { x: colItemX + 8, y: lineY - 8, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
      lineY -= 8 + 2;
    }

    for (const dline of detailLines) {
      page.drawText(dline, { x: colItemX + 8, y: lineY - 8, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
      lineY -= 8 + 2;
    }

    lineY -= 4;
    page.drawLine({
      start: { x: MARGIN, y: lineY },
      end: { x: A4.width - MARGIN, y: lineY },
      thickness: 0.4,
      color: rgb(0.9, 0.9, 0.9),
    });
    y = lineY - 2;
  }

  return doc.save();
}

/** Un ítem del formulario en blanco, listo para dibujar en el preview. */
export interface TemplatePreviewItem {
  label: string;
  /** Etiqueta del tipo (p. ej. "Estado", "Diagrama"). */
  typeLabel: string;
  /** Línea auxiliar (opciones de ESTADO, partes de SVG, …); ausente = espacio en blanco. */
  detail?: string;
  required: boolean;
}

/** Una sección (página) del formulario con su título, descripción e ítems. */
export interface TemplatePreviewSection {
  title: string;
  description?: string;
  items: readonly TemplatePreviewItem[];
}

/** Datos de cabecera + secciones para componer el PDF de preview de la plantilla. */
export interface TemplatePreviewPdfData {
  assetCode: string;
  assetName: string;
  templateName: string;
  sections: readonly TemplatePreviewSection[];
}

/**
 * Compone el PDF de PREVIEW de una plantilla de checklist (A4 vertical): el
 * formulario oficial EN BLANCO. Cabecera con el activo + nombre de la plantilla y,
 * por sección (título + descripción), la lista de ítems con su tipo. Para ESTADO
 * muestra las opciones; para SVG lista las partes por nombre; para el resto pinta
 * una línea de respuesta en blanco. Pagina automáticamente. Devuelve los bytes.
 */
export async function composeTemplatePreviewPdf(data: TemplatePreviewPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const usableW = A4.width - MARGIN * 2;
  let page = doc.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const newPage = (): void => {
    page = doc.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN;
  };
  const ensureSpace = (needed: number): void => {
    if (y - needed < MARGIN) {
      newPage();
    }
  };

  // ---- Cabecera ----
  page.drawText('Formulario de checklist', {
    x: MARGIN,
    y: y - 18,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 34;

  const headerLines = [
    `Activo: ${data.assetName} (${data.assetCode})`,
    `Plantilla: ${data.templateName}`,
    'Formulario oficial en blanco para inspección.',
  ];
  for (const line of headerLines) {
    page.drawText(truncate(line, font, 10, usableW), {
      x: MARGIN,
      y: y - 10,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 15;
  }

  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.75,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 18;

  const hasItems = data.sections.some((section) => section.items.length > 0);
  if (!hasItems) {
    page.drawText('La plantilla no tiene ítems.', {
      x: MARGIN,
      y: y - 10,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    return doc.save();
  }

  for (const section of data.sections) {
    // ---- Título de sección ----
    ensureSpace(28);
    page.drawText(truncate(section.title, fontBold, 13, usableW), {
      x: MARGIN,
      y: y - 13,
      size: 13,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 20;

    if (section.description) {
      for (const dline of wrap(section.description, font, 9, usableW)) {
        ensureSpace(13);
        page.drawText(dline, { x: MARGIN, y: y - 9, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
        y -= 13;
      }
    }
    y -= 4;

    if (section.items.length === 0) {
      ensureSpace(16);
      page.drawText('Sin ítems en esta sección.', {
        x: MARGIN + 8,
        y: y - 9,
        size: 9,
        font,
        color: rgb(0.6, 0.6, 0.6),
      });
      y -= 18;
      continue;
    }

    for (const item of section.items) {
      const labelText = `${item.label}${item.required ? ' *' : ''}`;
      const labelLines = wrap(labelText, fontBold, 10, usableW - 8);
      const detailLines = item.detail
        ? wrap(item.detail, font, 9, usableW - 12)
        : ['Respuesta: ____________________________'];
      const rowHeight = labelLines.length * (10 + 4) + (9 + 3) + detailLines.length * (9 + 3) + 8;

      ensureSpace(rowHeight);

      let lineY = y;
      for (const lline of labelLines) {
        page.drawText(lline, { x: MARGIN, y: lineY - 10, size: 10, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
        lineY -= 10 + 4;
      }
      page.drawText(`Tipo: ${item.typeLabel}`, {
        x: MARGIN + 12,
        y: lineY - 9,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      lineY -= 9 + 3;
      for (const dline of detailLines) {
        page.drawText(dline, { x: MARGIN + 12, y: lineY - 9, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
        lineY -= 9 + 3;
      }

      lineY -= 6;
      page.drawLine({
        start: { x: MARGIN, y: lineY },
        end: { x: A4.width - MARGIN, y: lineY },
        thickness: 0.3,
        color: rgb(0.92, 0.92, 0.92),
      });
      y = lineY - 4;
    }

    y -= 8;
  }

  return doc.save();
}

/** Envuelve `text` en líneas que quepan en `maxWidth` puntos. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // Palabra sola más ancha que la columna: recórtala con elipsis.
      current = font.widthOfTextAtSize(word, size) > maxWidth ? truncate(word, font, size, maxWidth) : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Recorta el texto con elipsis para que quepa en `maxWidth` puntos. */
function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
