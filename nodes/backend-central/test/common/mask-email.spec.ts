import { describe, it, expect } from 'vitest';
import { maskEmail } from '../../src/common/mask-email';

describe('maskEmail', () => {
  it('muestra los primeros 3 caracteres de la parte local y conserva el dominio', () => {
    expect(maskEmail('juanapalmo@gmail.com')).toBe('jua*****@gmail.com');
    expect(maskEmail('felipe.perez@gmt.cl')).toBe('fel*****@gmt.cl');
  });

  it('nunca revela la parte local completa en correos cortos', () => {
    // 3 chars -> muestra 2 (oculta al menos 1)
    expect(maskEmail('abc@x.cl')).toBe('ab*****@x.cl');
    // 2 chars -> muestra 1
    expect(maskEmail('ab@x.cl')).toBe('a*****@x.cl');
    // 1 char -> muestra 0 (oculta también el único carácter; invariante oculta >= 1)
    expect(maskEmail('a@x.cl')).toBe('*****@x.cl');
  });

  it('el resultado no contiene la parte local completa de un correo largo', () => {
    const masked = maskEmail('felipe.perez@gmt.cl');
    expect(masked).not.toContain('felipe.perez');
    expect(masked).not.toContain('perez');
    expect(masked.endsWith('@gmt.cl')).toBe(true);
  });

  it('entrada inválida o vacía devuelve una máscara genérica sin lanzar', () => {
    expect(maskEmail('')).toBe('*****');
    expect(maskEmail(null)).toBe('*****');
    expect(maskEmail(undefined)).toBe('*****');
    expect(maskEmail('sin-arroba')).toBe('*****');
    expect(maskEmail('@dominio.cl')).toBe('*****'); // sin parte local
    expect(maskEmail('local@')).toBe('*****'); // sin dominio
  });

  it('toma el último @ para correos con arroba en la parte local citada (borde)', () => {
    // 'a"b@c"@dom.cl' es raro pero maskEmail parte por el último @.
    const masked = maskEmail('abcd@dom.cl');
    expect(masked).toBe('abc*****@dom.cl');
  });
});
