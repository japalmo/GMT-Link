import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { allowedOrigins, resolveRp } from '../../../src/modules/signatures/webauthn.config';

describe('webauthn.config', () => {
  const original = process.env.WEBAUTHN_ORIGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.WEBAUTHN_ORIGINS;
    else process.env.WEBAUTHN_ORIGINS = original;
  });

  it('incluye por defecto los dominios conocidos de GMT', () => {
    delete process.env.WEBAUTHN_ORIGINS;
    const list = allowedOrigins();
    expect(list).toContain('https://gmt-link.gmtingenieria.com');
    expect(list).toContain('http://localhost:5173');
  });

  it('resolveRp acepta un origin de la lista y deriva el rpID del hostname', () => {
    delete process.env.WEBAUTHN_ORIGINS;
    expect(resolveRp('https://gmt-link.gmtingenieria.com')).toEqual({
      origin: 'https://gmt-link.gmtingenieria.com',
      rpID: 'gmt-link.gmtingenieria.com',
    });
  });

  it('resolveRp normaliza la barra final antes de comparar', () => {
    delete process.env.WEBAUTHN_ORIGINS;
    expect(resolveRp('https://gmt-link.gmtingenieria.com/').rpID).toBe('gmt-link.gmtingenieria.com');
  });

  it('resolveRp rechaza un origin fuera de la lista blanca (anti-spoofing de RP)', () => {
    delete process.env.WEBAUTHN_ORIGINS;
    expect(() => resolveRp('https://evil.example.com')).toThrow(BadRequestException);
    expect(() => resolveRp(undefined)).toThrow(BadRequestException);
    expect(() => resolveRp('')).toThrow(BadRequestException);
  });

  it('respeta el override por env WEBAUTHN_ORIGINS (CSV)', () => {
    process.env.WEBAUTHN_ORIGINS = 'https://a.test, https://b.test';
    expect(allowedOrigins()).toEqual(['https://a.test', 'https://b.test']);
    expect(resolveRp('https://a.test').rpID).toBe('a.test');
    expect(() => resolveRp('https://gmt-link.gmtingenieria.com')).toThrow(BadRequestException);
  });
});
