import { describe, it, expect, afterEach } from 'vitest';
import { validateAuthJwtSecret } from '../../src/common/env';

/**
 * validateAuthJwtSecret debe abortar el arranque cuando AUTH_JWT_SECRET
 * está ausente o es demasiado corto (< 32 bytes UTF-8). Un secreto HS256
 * corto es adivinable por fuerza bruta, así que exigimos >= 32.
 */
describe('validateAuthJwtSecret', () => {
  const original = process.env.AUTH_JWT_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = original;
  });

  it('lanza si AUTH_JWT_SECRET está ausente', () => {
    delete process.env.AUTH_JWT_SECRET;
    expect(() => validateAuthJwtSecret()).toThrow(/AUTH_JWT_SECRET/);
  });

  it('lanza si AUTH_JWT_SECRET tiene menos de 32 bytes', () => {
    process.env.AUTH_JWT_SECRET = 'corto'; // 5 bytes
    expect(() => validateAuthJwtSecret()).toThrow(/32/);
  });

  it('lanza si AUTH_JWT_SECRET tiene exactamente 31 bytes', () => {
    process.env.AUTH_JWT_SECRET = 'a'.repeat(31);
    expect(() => validateAuthJwtSecret()).toThrow(/32/);
  });

  it('no lanza con un secreto de 32 bytes exactos', () => {
    process.env.AUTH_JWT_SECRET = 'a'.repeat(32);
    expect(() => validateAuthJwtSecret()).not.toThrow();
  });

  it('cuenta bytes UTF-8, no caracteres (multibyte)', () => {
    // 16 emojis de 4 bytes c/u = 64 bytes pero sólo 16 code points visibles.
    process.env.AUTH_JWT_SECRET = '😀'.repeat(16);
    expect(() => validateAuthJwtSecret()).not.toThrow();
  });
});
