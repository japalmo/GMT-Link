import { describe, it, expect } from 'vitest';
import { recoverPasswordError } from './recuperar-clave';

describe('recoverPasswordError', () => {
  it('rechaza contraseñas de menos de 8 caracteres', () => {
    expect(recoverPasswordError('corta', 'corta')).toMatch(/8 caracteres/);
  });

  it('rechaza cuando la confirmación no coincide', () => {
    expect(recoverPasswordError('clavelarga1', 'clavelarga2')).toMatch(/no coinciden/);
  });

  it('acepta una contraseña válida y confirmada', () => {
    expect(recoverPasswordError('clavelarga1', 'clavelarga1')).toBeNull();
  });

  it('prioriza el largo mínimo sobre la coincidencia (misma clave corta)', () => {
    // Ambas iguales pero cortas: el error de largo se reporta primero.
    expect(recoverPasswordError('abc', 'abc')).toMatch(/8 caracteres/);
  });
});
