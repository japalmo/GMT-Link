import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';

/** Boletas por página admitidas en la impresión en lote (§6-3.2). */
export type ReceiptsPerPage = 2 | 4 | 6;

/** Tipo de archivo de la boleta, deducido por los bytes mágicos. */
export type ReceiptKind = 'pdf' | 'jpg' | 'png' | 'other';

/** Orientación de la hoja. */
export type PageOrientation = 'portrait' | 'landscape';

/** Tamaño de hoja soportado. */
export type PageSize = 'A4' | 'letter';

/** Opciones de composición del lote (spec §5.7). */
export interface ComposeOptions {
  perPage: ReceiptsPerPage;
  orientation?: PageOrientation;
  size?: PageSize;
}

/** Una boleta lista para componer en el PDF (texto ya formateado). */
export interface ReceiptForPdf {
  concept: string;
  amountLabel: string;
  categoryLabel: string;
  requesterName: string;
  dateLabel: string;
  bytes: Buffer;
  kind: ReceiptKind;
}

/** Dimensiones base por tamaño (puntos), en vertical. */
const PAGE_SIZES: Readonly<Record<PageSize, { width: number; height: number }>> = {
  A4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};
const MARGIN = 28;
const GAP = 14;
const CAPTION_H = 30;
const CELL_PAD = 6;

/** Columnas/filas por cada distribución (2 = 1×2, 4 = 2×2, 6 = 2×3). */
const GRID: Readonly<Record<ReceiptsPerPage, { cols: number; rows: number }>> = {
  2: { cols: 1, rows: 2 },
  4: { cols: 2, rows: 2 },
  6: { cols: 2, rows: 3 },
};

/** Deduce el tipo de boleta por los primeros bytes (firma del archivo). */
export function sniffReceiptKind(bytes: Buffer): ReceiptKind {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf'; // "%PDF"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  return 'other';
}

/**
 * Compone un PDF con las boletas en una grilla de `perPage` por página A4.
 * Las imágenes (JPG/PNG) se embeben escaladas; las boletas en PDF se incrustan
 * (su primera página) en la celda; formatos no soportados (WebP/HEIC) muestran
 * un marcador. Cada celda lleva un encabezado con concepto, solicitante, fecha y
 * monto. Devuelve los bytes del PDF resultante.
 */
export async function composeReceiptsPdf(
  receipts: readonly ReceiptForPdf[],
  options: ComposeOptions,
): Promise<Uint8Array> {
  const { perPage } = options;
  const base = PAGE_SIZES[options.size ?? 'A4'];
  const page =
    (options.orientation ?? 'portrait') === 'landscape'
      ? { width: base.height, height: base.width }
      : base;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { cols, rows } = GRID[perPage];
  const usableW = page.width - MARGIN * 2;
  const usableH = page.height - MARGIN * 2;
  const cellW = (usableW - (cols - 1) * GAP) / cols;
  const cellH = (usableH - (rows - 1) * GAP) / rows;

  let pdfPage: PDFPage | null = null;
  for (let i = 0; i < receipts.length; i += 1) {
    const slot = i % perPage;
    if (slot === 0) {
      pdfPage = doc.addPage([page.width, page.height]);
    }
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = MARGIN + col * (cellW + GAP);
    const yBottom = page.height - MARGIN - row * (cellH + GAP) - cellH;
    // `pdfPage` siempre existe aquí (se crea en slot === 0).
    await drawCell(doc, pdfPage as PDFPage, font, fontBold, receipts[i] as ReceiptForPdf, x, yBottom, cellW, cellH);
  }

  return doc.save();
}

/** Dibuja una celda: borde, encabezado y la boleta ajustada al área disponible. */
async function drawCell(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  receipt: ReceiptForPdf,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 0.75,
  });

  const textX = x + CELL_PAD;
  const topY = y + h - CELL_PAD;
  const concept = truncate(receipt.concept, fontBold, 9, w - CELL_PAD * 2);
  page.drawText(concept, { x: textX, y: topY - 9, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  const meta = truncate(
    `${receipt.requesterName}  -  ${receipt.dateLabel}  -  ${receipt.amountLabel}  -  ${receipt.categoryLabel}`,
    font,
    7.5,
    w - CELL_PAD * 2,
  );
  page.drawText(meta, { x: textX, y: topY - 20, size: 7.5, font, color: rgb(0.42, 0.42, 0.42) });

  const areaX = x + CELL_PAD;
  const areaY = y + CELL_PAD;
  const areaW = w - CELL_PAD * 2;
  const areaH = h - CAPTION_H - CELL_PAD;

  try {
    if (receipt.kind === 'jpg' || receipt.kind === 'png') {
      const img = receipt.kind === 'jpg' ? await doc.embedJpg(receipt.bytes) : await doc.embedPng(receipt.bytes);
      drawContained(img.width, img.height, areaX, areaY, areaW, areaH, (dx, dy, dw, dh) =>
        page.drawImage(img, { x: dx, y: dy, width: dw, height: dh }),
      );
    } else if (receipt.kind === 'pdf') {
      const [embedded] = await doc.embedPdf(receipt.bytes, [0]);
      if (embedded) {
        drawContained(embedded.width, embedded.height, areaX, areaY, areaW, areaH, (dx, dy, dw, dh) =>
          page.drawPage(embedded, { x: dx, y: dy, width: dw, height: dh }),
        );
      }
    } else {
      placeholder(page, font, areaX, areaY, areaW, areaH, 'Boleta en formato no incluible (WebP/HEIC).');
    }
  } catch {
    placeholder(page, font, areaX, areaY, areaW, areaH, 'No se pudo incrustar la boleta.');
  }
}

/** Escala (sin deformar) un contenido `iw×ih` para caber centrado en el área. */
function drawContained(
  iw: number,
  ih: number,
  areaX: number,
  areaY: number,
  areaW: number,
  areaH: number,
  draw: (x: number, y: number, w: number, h: number) => void,
): void {
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.min(areaW / iw, areaH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = areaX + (areaW - dw) / 2;
  const dy = areaY + (areaH - dh) / 2;
  draw(dx, dy, dw, dh);
}

/** Texto centrado de marcador cuando no se puede incrustar la boleta. */
function placeholder(
  page: PDFPage,
  font: PDFFont,
  areaX: number,
  areaY: number,
  areaW: number,
  areaH: number,
  text: string,
): void {
  const size = 8;
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: areaX + Math.max(0, (areaW - width) / 2),
    y: areaY + areaH / 2,
    size,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });
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
