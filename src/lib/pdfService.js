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
