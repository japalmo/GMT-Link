import { describe, expect, it } from 'vitest';
import { generateProvisionalPassword } from '../../src/common/provisional-password';

const LOWER = /[a-z]/;
const UPPER = /[A-Z]/;
const DIGIT = /[0-9]/;
const SYMBOL = /[!@#$%*?_-]/;
const AMBIGUOUS = /[Oo0lI1]/;

describe('generateProvisionalPassword', () => {
  it('tiene al menos 12 caracteres por defecto', () => {
    expect(generateProvisionalPassword().length).toBeGreaterThanOrEqual(12);
  });

  it('respeta una longitud mayor solicitada', () => {
    expect(generateProvisionalPassword(20)).toHaveLength(20);
  });

  it('clampa longitudes menores al mínimo de 12', () => {
    expect(generateProvisionalPassword(4).length).toBe(12);
  });

  it('incluye al menos una minúscula, mayúscula, dígito y símbolo', () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generateProvisionalPassword();
      expect(LOWER.test(pwd), `falta minúscula en "${pwd}"`).toBe(true);
      expect(UPPER.test(pwd), `falta mayúscula en "${pwd}"`).toBe(true);
      expect(DIGIT.test(pwd), `falta dígito en "${pwd}"`).toBe(true);
      expect(SYMBOL.test(pwd), `falta símbolo en "${pwd}"`).toBe(true);
    }
  });

  it('no usa caracteres ambiguos (O/0, l/1/I)', () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generateProvisionalPassword();
      expect(AMBIGUOUS.test(pwd), `carácter ambiguo en "${pwd}"`).toBe(false);
    }
  });

  it('genera claves distintas en llamadas sucesivas (alta entropía)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(generateProvisionalPassword());
    }
    expect(set.size).toBe(100);
  });
});
