import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from '../../src/common/jwt';

const SECRET = 'test-secret-para-vitest-32bytes-min';

beforeAll(() => {
  process.env.AUTH_JWT_SECRET = SECRET;
});

describe('jwt helper', () => {
  it('firma y verifica devolviendo el sub y la época de sesión', () => {
    const token = signToken('user-123', 3);
    expect(verifyToken(token)).toEqual({ sub: 'user-123', tokenVersion: 3 });
  });
  it('devuelve null ante un token inválido', () => {
    expect(verifyToken('no-es-un-jwt')).toBeNull();
  });
  it('devuelve null ante un token legacy sin tokenVersion (previo a A3)', () => {
    const legacy = jwt.sign({ sub: 'user-123' }, SECRET, { algorithm: 'HS256' });
    expect(verifyToken(legacy)).toBeNull();
  });
  it('devuelve null ante firma con otro secreto', () => {
    const token = signToken('user-123', 0);
    process.env.AUTH_JWT_SECRET = 'otro-secreto-distinto-cualquiera-x';
    expect(verifyToken(token)).toBeNull();
    process.env.AUTH_JWT_SECRET = SECRET;
  });
});
