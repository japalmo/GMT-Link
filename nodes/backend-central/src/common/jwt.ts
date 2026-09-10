import jwt from 'jsonwebtoken';

/** Vida del token de sesión (cómodo para la demo; sin refresh tokens). */
const TTL = '7d';

/**
 * Claims que llevamos: el id del usuario (`sub`) y la época de sesión (`tokenVersion`,
 * claim corto `tv`). El resto se relee de Postgres. Al incrementar `tokenVersion` en
 * el usuario, todos sus JWT previos quedan inválidos (revocación de sesión, A3).
 */
export interface AuthTokenPayload {
  sub: string;
  tokenVersion: number;
}

function secret(): string {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error('AUTH_JWT_SECRET no está configurado.');
  return s;
}

/** Firma un JWT HS256 con `sub = userId` y la época de sesión (`tv`). */
export function signToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, tv: tokenVersion }, secret(), {
    algorithm: 'HS256',
    expiresIn: TTL,
  } as jwt.SignOptions);
}

/**
 * Verifica firma + expiración. Devuelve `{ sub, tokenVersion }` o `null` si es
 * inválido. Un token sin el claim `tv` (legacy, previo a A3) se considera inválido
 * → fuerza re-login.
 */
export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && decoded !== null) {
      const sub = (decoded as jwt.JwtPayload).sub;
      const tv = (decoded as jwt.JwtPayload & { tv?: unknown }).tv;
      if (typeof sub === 'string' && sub.length > 0 && typeof tv === 'number') {
        return { sub, tokenVersion: tv };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pase temporal del tablero público de obra. Lo entrega el backend cuando
 * alguien acierta la clave del proyecto, y solo sirve para ESE proyecto: el
 * token público va firmado dentro, así que un pase no abre otro tablero.
 *
 * Dura una jornada: la TV de faena se desbloquea en la mañana y no vuelve a
 * pedir la clave durante el turno.
 */
const TTL_PASE_OBRA = '12h';

export function signObraPass(projectPublicToken: string): string {
  return jwt.sign({ pt: projectPublicToken, kind: 'obra' }, secret(), {
    algorithm: 'HS256',
    expiresIn: TTL_PASE_OBRA,
  } as jwt.SignOptions);
}

/** ¿Este pase es válido y corresponde a este proyecto? */
export function verifyObraPass(pase: string, projectPublicToken: string): boolean {
  try {
    const decoded = jwt.verify(pase, secret(), { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return false;
    const d = decoded as jwt.JwtPayload & { pt?: unknown; kind?: unknown };
    return d.kind === 'obra' && d.pt === projectPublicToken;
  } catch {
    return false;
  }
}
