import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatDateRange,
  toDateInputValue,
  formatRelativeTime,
  formatCLP,
  formatBytes,
} from './format';

describe('formatDate', () => {
  it('devuelve el fallback para null/vacío/fecha inválida', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('no-es-fecha')).toBe('—');
    expect(formatDate(null, 'N/D')).toBe('N/D');
  });

  it('formatea una fecha ISO válida (incluye el año)', () => {
    const out = formatDate('2026-06-14T12:00:00Z');
    expect(out).not.toBe('—');
    expect(out).toContain('2026');
  });
});

describe('formatDateRange', () => {
  it('start + end → "inicio – fin"', () => {
    expect(formatDateRange('2020-01-15T00:00:00Z', '2022-03-10T00:00:00Z')).toMatch(/2020.*–.*2022/);
  });

  it('solo start → usa "Actual" como fin', () => {
    expect(formatDateRange('2020-01-15T00:00:00Z', null)).toMatch(/2020.*–.*Actual/);
  });

  it('solo end → devuelve el fin formateado', () => {
    expect(formatDateRange(null, '2022-03-10T00:00:00Z')).toContain('2022');
  });

  it('ni start ni end con present "Actual" → cadena vacía', () => {
    expect(formatDateRange(null, null)).toBe('');
  });

  it('respeta un present personalizado', () => {
    expect(formatDateRange('2020-01-15T00:00:00Z', null, 'Vigente')).toMatch(/Vigente$/);
  });
});

describe('toDateInputValue', () => {
  it('convierte ISO a yyyy-MM-dd (UTC)', () => {
    expect(toDateInputValue('2026-06-14T23:30:00Z')).toBe('2026-06-14');
  });

  it('devuelve "" para null/inválido', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue('basura')).toBe('');
  });
});

describe('formatRelativeTime', () => {
  it('diferencias menores a un minuto → "hace un momento"', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('hace un momento');
  });

  it('fallback para null/inválido', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime('xxx')).toBe('—');
    expect(formatRelativeTime(null, 'sin fecha')).toBe('sin fecha');
  });

  it('una fecha pasada produce un texto relativo distinto del fallback', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const out = formatRelativeTime(fiveMinAgo);
    expect(out).not.toBe('—');
    expect(out).not.toBe('hace un momento');
  });
});

describe('formatCLP', () => {
  it('formatea pesos chilenos sin decimales', () => {
    const out = formatCLP(25000);
    expect(out).toContain('$');
    expect(out).toContain('25.000');
    expect(out).not.toContain(',');
  });
});

describe('formatBytes', () => {
  it('bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('kilobytes (redondeo sin decimales)', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('megabytes (es-CL usa coma decimal)', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});
