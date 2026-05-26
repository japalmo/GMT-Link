import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { formatCurrencyCLP, formatDateTime, formatShortDate } from './formatters';

/**
 * Generates a payment voucher PDF for a batch of reimbursements.
 * 
 * @param {Object} batchData - Data from the payment batch document.
 * @param {Array} requests - Array of reimbursement objects included in the batch.
 * @param {Object} profile - Profile of the user performing the download.
 */
export function generatePaymentPDF(batchData, requests = []) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  const safe = (val, fallback = '—') => (val != null && val !== '' ? val : fallback);

  // Header
  doc.setFontSize(18);
  doc.setTextColor(37, 99, 235);
  doc.text('COMPROBANTE DE PAGO', pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Referencia: ${safe(batchData.batchNumber)}`, pageWidth / 2, 27, { align: 'center' });
  doc.text(`Fecha de emisión: ${formatShortDate(new Date())}`, pageWidth / 2, 32, { align: 'center' });

  doc.setDrawColor(226, 232, 240);
  doc.line(15, 38, pageWidth - 15, 38);

  // Worker Data
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('DATOS DEL TRABAJADOR', 15, 48);

  doc.setFontSize(10);
  const workerName = safe(batchData.workerName || batchData.worker || batchData.fullName);
  const workerRut = safe(batchData.workerRut || batchData.rut);
  const centerCost = safe(batchData.centerCost);
  doc.text(`Nombre: ${workerName}`, 15, 55);
  doc.text(`RUT: ${workerRut}`, 15, 60);
  doc.text(`Centro de Costo: ${centerCost}`, 15, 65);

  doc.text(`Banco: ${safe(batchData.bankName)}`, pageWidth / 2, 55);
  doc.text(`Tipo Cuenta: ${safe(batchData.bankAccountType)}`, pageWidth / 2, 60);
  doc.text(`N° Cuenta: ${safe(batchData.bankAccountNumber)}`, pageWidth / 2, 65);

  let finalY = 75;

  if (requests.length > 0) {
    const tableRows = requests.map(req => [
      safe(req.requestNumber),
      formatShortDate(req.expenseDate || req.submittedAt),
      req.concept || '—',
      formatCurrencyCLP(req.amount),
    ]);

    doc.autoTable({
      startY: finalY,
      head: [['Solicitud', 'Fecha Gasto', 'Concepto', 'Monto']],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      columnStyles: { 3: { halign: 'right' } },
      margin: { left: 15, right: 15 },
    });
    finalY = doc.lastAutoTable.finalY || finalY + 20;
  } else {
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('No se pudieron cargar los detalles de las solicitudes.', 15, finalY + 10);
    finalY += 15;
  }

  // Summary
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text('RESUMEN DE PAGO', 15, finalY + 15);

  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`Cantidad de solicitudes: ${batchData.requestCount || requests.length || '—'}`, 15, finalY + 22);
  doc.text(`Referencia bancaria: ${safe(batchData.paymentReference, 'Sin referencia')}`, 15, finalY + 27);

  doc.setFontSize(14);
  doc.setTextColor(37, 99, 235);
  const total = batchData.totalAmount || requests.reduce((s, r) => s + Number(r.amount || 0), 0);
  doc.text(`TOTAL PAGADO: ${formatCurrencyCLP(total)}`, pageWidth - 15, finalY + 25, { align: 'right' });

  doc.setDrawColor(226, 232, 240);
  doc.line(15, finalY + 35, pageWidth - 15, finalY + 35);

  // Audit
  const paidByName = safe(batchData.paidByName || batchData.paidBy);
  const paidAt = batchData.paidAt ? formatDateTime(batchData.paidAt) : formatDateTime(new Date());
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Pagado por: ${paidByName} el ${paidAt}`, 15, finalY + 42);
  doc.text('Este documento es un comprobante interno de gestión de reembolsos.', 15, finalY + 47);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(203, 213, 225);
  doc.text('GMT Link — Comprobante generado automáticamente', pageWidth / 2, finalY + 55, { align: 'center' });

  const dateStr = formatShortDate(batchData.paidAt || new Date()).replace(/\//g, '-');
  doc.save(`comprobante-pago-${batchData.batchNumber || batchData.paymentReference || 'lote'}-${dateStr}.pdf`);
}

/**
 * Loads an image from a URL and returns a Promise that resolves to a base64 string or HTMLImageElement.
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image at ${url}`));
    img.src = url;
  });
}

/**
 * Generates a PDF with multiple receipts (4 per page) for physical registration.
 * 
 * @param {Array} reimbursements - Array of reimbursement objects to print.
 */
export async function generateReceiptsBatchPDF(reimbursements) {
  const doc = new jsPDF();
  const margin = 10;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const boxWidth = (pageWidth - (margin * 3)) / 2;
  const boxHeight = (pageHeight - (margin * 3)) / 2;

  for (let i = 0; i < reimbursements.length; i++) {
    const item = reimbursements[i];
    const boxIndex = i % 4;
    
    if (boxIndex === 0 && i > 0) {
      doc.addPage();
    }

    const col = boxIndex % 2;
    const row = Math.floor(boxIndex / 2);
    
    const x = margin + (col * (boxWidth + margin));
    const y = margin + (row * (boxHeight + margin));

    // Draw box border
    doc.setDrawColor(226, 232, 240);
    doc.rect(x, y, boxWidth, boxHeight);

    // Header info
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text(item.requestNumber || 'S/N', x + 5, y + 8);
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(formatShortDate(item.expenseDate || item.submittedAt), x + 5, y + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(formatCurrencyCLP(item.amount), x + boxWidth - 5, y + 8, { align: 'right' });

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.text(item.workerName || '', x + 5, y + 18, { maxWidth: boxWidth - 10 });
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(item.concept || '', x + 5, y + 23, { maxWidth: boxWidth - 10 });

    // Draw image if available
    const imageUrl = item.attachmentUrls?.[0];
    if (imageUrl) {
      try {
        const img = await loadImage(imageUrl);
        
        // Calculate dimensions to fit in the box while maintaining aspect ratio
        const imgPadding = 5;
        const availableWidth = boxWidth - (imgPadding * 2);
        const availableHeight = boxHeight - 30 - imgPadding; // 30 is space for text
        
        const imgWidth = img.width;
        const imgHeight = img.height;
        const ratio = Math.min(availableWidth / imgWidth, availableHeight / imgHeight);
        
        const finalWidth = imgWidth * ratio;
        const finalHeight = imgHeight * ratio;
        
        const imgX = x + ((boxWidth - finalWidth) / 2);
        const imgY = y + 28 + ((availableHeight - finalHeight) / 2);

        doc.addImage(img, 'JPEG', imgX, imgY, finalWidth, finalHeight);
      } catch {
        doc.setFontSize(7);
        doc.setTextColor(239, 68, 68);
        doc.text('No se pudo cargar la imagen del comprobante', x + 5, y + 35);
      }
    } else {
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('Sin imagen adjunta', x + (boxWidth / 2), y + (boxHeight / 2) + 10, { align: 'center' });
    }
  }

  const dateStr = formatShortDate(new Date()).replace(/\//g, '-');
  doc.save(`lote-boletas-gmt-${dateStr}.pdf`);
}
