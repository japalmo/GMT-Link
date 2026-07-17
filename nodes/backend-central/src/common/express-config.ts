import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Ajustes de Express que la app NECESITA y que son fáciles de perder en silencio
 * (ninguno falla ruidosamente si falta; simplemente algo deja de funcionar). Viven
 * aquí, juntos y testeados, en vez de sueltos en el bootstrap.
 *
 * - `trust proxy = 1`: detrás del proxy de Railway, para que `req.ip` sea la IP real
 *   del cliente (X-Forwarded-For). Sin esto el rate-limit por IP colapsa en un único
 *   balde global y un atacante bloquea el login de todos. También habilita HSTS
 *   correcto (helmet detecta https por el proxy).
 * - `query parser = 'extended'` (qs): Express 5 —el que trae NestJS 11— cambió el
 *   default a 'simple' (querystring), que NO interpreta la notación de corchetes.
 *   Con 'simple', `?filters[type]=EQUIPO` llega como la clave literal
 *   "filters[type]" y `@Query('filters')` queda `undefined`: TODOS los filtros
 *   server-side del motor de tablas (activos por tipo, usuarios, finanzas,
 *   inventario) se descartaban en silencio y cada pestaña listaba todo. Con
 *   'extended' vuelve a parsearse como `{ filters: { type: 'EQUIPO' } }`.
 */
export function configureExpress(app: NestExpressApplication): void {
  app.set('trust proxy', 1);
  app.set('query parser', 'extended');
}
