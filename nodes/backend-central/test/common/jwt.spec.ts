import { describe, it, expect, beforeAll } from 'vitest';
import { signToken, verifyToken } from '../../src/common/jwt';

beforeAll(() => {
  process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min';
});

describe('jwt helper', () => {
  it('firma y verifica devolviendo el sub', () => {
    const token = signToken('user-123');
    expect(verifyToken(token)).toEqual({ sub: 'user-123' });
  });
  it('devuelve null ante un token inválido', () => {
    expect(verifyToken('no-es-un-jwt')).toBeNull();
  });
  it('devuelve null ante firma con otro secreto', () => {
    const token = signToken('user-123');
    process.env.AUTH_JWT_SECRET = 'otro-secreto-distinto-cualquiera-x';
    expect(verifyToken(token)).toBeNull();
    process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min';
  });
});
