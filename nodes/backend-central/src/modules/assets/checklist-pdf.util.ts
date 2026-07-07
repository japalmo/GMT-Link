import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';

/** Un ítem de la plantilla con su respuesta ya resuelta, listo para dibujar. */
export interface ChecklistPdfRow {
  label: string;
  valueLabel: string;
  comment?: string;
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
    const rowLines = Math.max(labelLines.length, valueLines.length);
    const rowHeight = rowLines * (9 + LINE_GAP) + (commentLines.length > 0 ? commentLines.length * (8 + 2) + 4 : 0) + 6;

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
