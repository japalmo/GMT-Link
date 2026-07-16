import { describe, it, expect } from 'vitest';
import { computeContentHash } from '../../../src/modules/signatures/content-hash';

describe('computeContentHash', () => {
  it('es determinista e independiente del orden de las claves', () => {
    const a = computeContentHash({ templateId: 't1', userId: 'u1', answers: [{ itemId: 'x', value: 1 }] });
    const b = computeContentHash({ answers: [{ value: 1, itemId: 'x' }], userId: 'u1', templateId: 't1' });
    expect(a).toBe(b);
  });

  it('cambia si cambia cualquier parte del contenido', () => {
    const base = computeContentHash({ templateId: 't1', userId: 'u1', answers: [{ itemId: 'x', value: 1 }] });
    expect(computeContentHash({ templateId: 't2', userId: 'u1', answers: [{ itemId: 'x', value: 1 }] })).not.toBe(base);
    expect(computeContentHash({ templateId: 't1', userId: 'u2', answers: [{ itemId: 'x', value: 1 }] })).not.toBe(base);
    expect(computeContentHash({ templateId: 't1', userId: 'u1', answers: [{ itemId: 'x', value: 2 }] })).not.toBe(base);
  });

  it('devuelve base64url (sin +, / ni =)', () => {
    const h = computeContentHash({ any: 'content', n: 42, nested: { a: [1, 2, 3] } });
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('distingue el orden de un arreglo (los arreglos NO se ordenan)', () => {
    const h1 = computeContentHash({ answers: [{ itemId: 'a' }, { itemId: 'b' }] });
    const h2 = computeContentHash({ answers: [{ itemId: 'b' }, { itemId: 'a' }] });
    expect(h1).not.toBe(h2);
  });
});
