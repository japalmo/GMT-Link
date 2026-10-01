import { describe, it, expect, afterEach } from 'vitest';
import { validateAuthJwtSecret, validateStorageConfig } from '../../src/common/env';

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

  it('lanza si AUTH_JWT_SECRET es solo espacios (whitespace no cuenta como contenido)', () => {
    process.env.AUTH_JWT_SECRET = ' '.repeat(40);
    expect(() => validateAuthJwtSecret()).toThrow(/AUTH_JWT_SECRET/);
  });

  it('lanza si AUTH_JWT_SECRET tiene relleno de espacios: mide solo bytes útiles', () => {
    // 34 bytes crudos, pero recortando espacios quedan 30 bytes útiles (< 32).
    process.env.AUTH_JWT_SECRET = '  ' + 'a'.repeat(30) + '  ';
    expect(() => validateAuthJwtSecret()).toThrow(/32/);
  });
});

/**
 * validateStorageConfig: en producción, sin las 5 variables R2_*, el storage
 * caería en silencio al disco local (efímero) y montaría `/files` sin sesión.
 * El arranque debe abortar; en desarrollo no cambia nada.
 */
describe('validateStorageConfig', () => {
  const R2_COMPLETO = {
    R2_ACCOUNT_ID: 'cuenta',
    R2_ACCESS_KEY_ID: 'clave',
    R2_SECRET_ACCESS_KEY: 'secreto',
    R2_BUCKET: 'bucket',
    R2_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com',
  };

  it('en producción sin R2 lanza con un mensaje claro', () => {
    expect(() => validateStorageConfig({ NODE_ENV: 'production' })).toThrow(
      'R2_* incompleto: producción no puede usar storage local ni exponer /files',
    );
  });

  it('en producción con una sola variable R2_* faltante también lanza', () => {
    const incompleto: Record<string, string> = { ...R2_COMPLETO };
    delete incompleto.R2_ENDPOINT;
    expect(() => validateStorageConfig({ NODE_ENV: 'production', ...incompleto })).toThrow(
      /R2_\* incompleto/,
    );
  });

  it('en producción con R2 completo no lanza', () => {
    expect(() => validateStorageConfig({ NODE_ENV: 'production', ...R2_COMPLETO })).not.toThrow();
  });

  it('en desarrollo o sin NODE_ENV no exige R2', () => {
    expect(() => validateStorageConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateStorageConfig({})).not.toThrow();
  });
});
