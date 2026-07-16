import { BadRequestException } from '@nestjs/common';

/**
 * Configuración de la Relying Party (RP) de WebAuthn (#68).
 *
 * WebAuthn ata cada credencial al DOMINIO del frontend donde se registró (el rpID),
 * y la ceremonia corre en el navegador en ese origin. La API solo genera opciones y
 * verifica; su propio dominio es irrelevante para WebAuthn. Como GMT Link se sirve
 * desde varios dominios (local, web-dev, web-prod, dominio propio), se mantiene una
 * lista blanca de origins permitidos y, en cada request, se resuelve el rpID/origin
 * a partir del header `Origin` (validado contra la lista). Así una credencial
 * registrada en gmt-link.gmtingenieria.com se verifica contra ESE mismo dominio.
 */

/** Nombre visible de la RP (lo muestran algunos autenticadores). */
export const RP_NAME = 'GMT Link';

/** Origins de frontend permitidos por defecto (override por env WEBAUTHN_ORIGINS, CSV). */
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'https://web-dev-production-05f2.up.railway.app',
  'https://web-production-c6320.up.railway.app',
  'https://gmt-link.gmtingenieria.com',
];

/** Lista blanca efectiva de origins (normalizada, sin barra final). */
export function allowedOrigins(): string[] {
  const raw = process.env.WEBAUTHN_ORIGINS;
  const list = raw && raw.trim().length > 0 ? raw.split(',') : DEFAULT_ORIGINS;
  return list.map((o) => o.trim().replace(/\/+$/, '')).filter((o) => o.length > 0);
}

/** RP resuelta para una ceremonia: el origin exacto y su hostname como rpID. */
export interface ResolvedRp {
  origin: string;
  rpID: string;
}

/**
 * Resuelve la RP a partir del header `Origin` del request. Exige que el origin esté
 * en la lista blanca (si no, 400): la credencial se emite/verifica solo contra un
 * dominio de confianza, nunca contra uno arbitrario que envíe el cliente.
 */
export function resolveRp(originHeader: string | undefined): ResolvedRp {
  const origin = (originHeader ?? '').trim().replace(/\/+$/, '');
  if (origin.length === 0 || !allowedOrigins().includes(origin)) {
    throw new BadRequestException('Origen no autorizado para firmar con biometría.');
  }
  let rpID: string;
  try {
    rpID = new URL(origin).hostname;
  } catch {
    throw new BadRequestException('Origen inválido.');
  }
  return { origin, rpID };
}
