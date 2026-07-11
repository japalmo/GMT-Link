import { describe, expect, it } from 'vitest';
import {
  buildReceiptOcrMessages,
  parseReceiptOcr,
} from '../../src/modules/reimbursements/receipt-ocr.util';

describe('buildReceiptOcrMessages', () => {
  it('arma un mensaje multimodal con la imagen', () => {
    const msgs = buildReceiptOcrMessages('data:image/jpeg;base64,AAAA');
    expect(msgs).toHaveLength(1);
    const parts = msgs[0]?.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe(
      'data:image/jpeg;base64,AAAA',
    );
  });
});

describe('parseReceiptOcr', () => {
  it('extrae concept/amount/date/category del JSON del modelo', () => {
    const out = parseReceiptOcr(
      '{"concept":"Bencina","amount":25990,"date":"2026-07-05","category":"Vehículos"}',
    );
    expect(out).toEqual({
      concept: 'Bencina',
      amount: 25990,
      date: '2026-07-05',
      category: 'Vehículos',
    });
  });

  it('tolera fences y prosa alrededor del JSON', () => {
    const out = parseReceiptOcr('Aquí está:\n```json\n{"amount": 1500}\n```');
    expect(out.amount).toBe(1500);
    expect(out.concept).toBeUndefined();
  });

  it('ignora campos de tipo inválido (amount no numérico)', () => {
    const out = parseReceiptOcr('{"amount":"mucho","concept":42}');
    expect(out.amount).toBeUndefined();
    expect(out.concept).toBeUndefined();
  });
});
