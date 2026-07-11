import { describe, expect, it } from 'vitest';
import { composeReceiptsPdf, sniffReceiptKind } from '../../src/modules/reimbursements/reimbursements-pdf.util';
import type { ReceiptForPdf } from '../../src/modules/reimbursements/reimbursements-pdf.util';

// PNG 1x1 mínimo válido.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function receipt(): ReceiptForPdf {
  return {
    concept: 'Bencina',
    amountLabel: '$25.990',
    categoryLabel: 'Vehículos',
    requesterName: 'Ana Pérez',
    dateLabel: '2026-07-05',
    bytes: PNG_1x1,
    kind: sniffReceiptKind(PNG_1x1),
  };
}

describe('composeReceiptsPdf', () => {
  it('genera un PDF (bytes %PDF) en A4 portrait por defecto', async () => {
    const pdf = await composeReceiptsPdf([receipt()], { perPage: 2 });
    expect(Buffer.from(pdf.slice(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('acepta landscape + letter sin romper', async () => {
    const pdf = await composeReceiptsPdf([receipt(), receipt()], {
      perPage: 4,
      orientation: 'landscape',
      size: 'letter',
    });
    expect(pdf.byteLength).toBeGreaterThan(100);
  });
});
