import { describe, it, expect } from 'vitest';
import { handleHealth } from './app.js';

describe('auth-service handleHealth', () => {
  it('reporta ok con el nombre del servicio', () => {
    expect(handleHealth()).toEqual({ status: 'ok', service: 'auth-service' });
  });
});
