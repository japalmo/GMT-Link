import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureExpress } from '../../src/common/express-config';

/**
 * Guarda dos ajustes de Express que NO fallan ruidosamente si se pierden: si alguien
 * borra una línea, nada revienta, simplemente algo deja de funcionar en silencio.
 *
 * - `query parser = 'extended'`: sin esto, Express 5 (el default de NestJS 11) usa
 *   'simple' y NO parsea `?filters[type]=EQUIPO`; la clave llega literal,
 *   `@Query('filters')` queda `undefined` y TODOS los filtros server-side del motor
 *   de tablas se descartan (cada pestaña de Recursos listaba todo). Verificado contra
 *   un Express 5 real: 'simple' -> { "filters[type]": "EQUIPO" } (filtro perdido);
 *   'extended' -> { filters: { type: "EQUIPO" } } (filtro aplicado).
 * - `trust proxy = 1`: sin esto, tras el proxy de Railway `req.ip` no es la IP real y
 *   el rate-limit por IP colapsa en un balde global (un atacante bloquea a todos).
 */
describe('configureExpress', () => {
  function settingsApplied(): Array<[string, unknown]> {
    const calls: Array<[string, unknown]> = [];
    const app = {
      set: vi.fn((key: string, value: unknown) => {
        calls.push([key, value]);
      }),
    } as unknown as NestExpressApplication;
    configureExpress(app);
    return calls;
  }

  it('fija query parser = extended (Express 5 trae "simple", que pierde los filtros)', () => {
    expect(settingsApplied()).toContainEqual(['query parser', 'extended']);
  });

  it('fija trust proxy = 1 (req.ip real tras el proxy; si no, el rate-limit por IP colapsa)', () => {
    expect(settingsApplied()).toContainEqual(['trust proxy', 1]);
  });
});
