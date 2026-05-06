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
export function generatePaymentPDF(batchData, requests) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.setTextColor(37, 99, 235); // primary.main color
  doc.text('COMPROBANTE DE PAGO', pageWidth / 2, 20, { align: 'center' });
  
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // text.secondary
  doc.text(`Referencia: ${batchData.batchNumber || 'N/A'}`, pageWidth / 2, 27, { align: 'center' });
  doc.text(`Fecha de emisión: ${formatShortDate(new Date())}`, pageWidth / 2, 32, { align: 'center' });

  doc.setDrawColor(226, 232, 240);
  doc.line(15, 38, pageWidth - 15, 38);

  // Worker Data
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59); // text.primary
  doc.text('DATOS DEL TRABAJADOR', 15, 48);
  
  doc.setFontSize(10);
  doc.text(`Nombre: ${batchData.workerName}`, 15, 55);
  doc.text(`RUT: ${batchData.workerRut}`, 15, 60);
  doc.text(`Centro de Costo: ${batchData.centerCost}`, 15, 65);
  
  // Bank Data
  doc.text(`Banco: ${batchData.bankName || 'N/A'}`, pageWidth / 2, 55);
  doc.text(`Tipo Cuenta: ${batchData.bankAccountType || 'N/A'}`, pageWidth / 2, 60);
  doc.text(`N° Cuenta: ${batchData.bankAccountNumber || 'N/A'}`, pageWidth / 2, 65);

  // Table of Requests
  const tableRows = requests.map(req => [
    req.requestNumber,
    formatShortDate(req.expenseDate || req.submittedAt),
    req.concept,
    formatCurrencyCLP(req.amount)
  ]);

  doc.autoTable({
    startY: 75,
    head: [['Solicitud', 'Fecha Gasto', 'Concepto', 'Monto']],
    body: tableRows,
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    columnStyles: {
      3: { halign: 'right' }
    },
    margin: { left: 15, right: 15 }
  });

  const finalY = doc.lastAutoTable.finalY || 150;

  // Totals and Payment Info
  doc.setFontSize(11);
  doc.text('RESUMEN DE PAGO', 15, finalY + 15);
  
  doc.setFontSize(10);
  doc.text(`Cantidad de solicitudes: ${batchData.requestCount || requests.length}`, 15, finalY + 22);
  doc.text(`Referencia bancaria: ${batchData.paymentReference || 'Sin referencia'}`, 15, finalY + 27);
  
  doc.setFontSize(14);
  doc.setTextColor(37, 99, 235);
  doc.text(`TOTAL PAGADO: ${formatCurrencyCLP(batchData.totalAmount)}`, pageWidth - 15, finalY + 25, { align: 'right' });

  doc.setDrawColor(226, 232, 240);
  doc.line(15, finalY + 35, pageWidth - 15, finalY + 35);

  // Audit
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // text.disabled/secondary
  doc.text(`Pagado por: ${batchData.paidByName} el ${formatDateTime(batchData.paidAt)}`, 15, finalY + 42);
  doc.text('Este documento es un comprobante interno de gestión de reembolsos.', 15, finalY + 47);

  // Save PDF
  const filename = `comprobante-pago-${batchData.paymentReference || 'batch'}-${formatShortDate(batchData.paidAt).replace(/\//g, '-')}.pdf`;
  doc.save(filename);
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
