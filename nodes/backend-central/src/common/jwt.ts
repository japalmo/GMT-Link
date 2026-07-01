import jwt from 'jsonwebtoken';

/** Vida del token de sesión (cómodo para la demo; sin refresh tokens). */
const TTL = '7d';

/** Claim que llevamos: solo el id del usuario. El resto se relee de Postgres. */
export interface AuthTokenPayload {
  sub: string;
}

function secret(): string {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error('AUTH_JWT_SECRET no está configurado.');
  return s;
}

/** Firma un JWT HS256 con `sub = userId`. */
export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, secret(), { algorithm: 'HS256', expiresIn: TTL } as jwt.SignOptions);
}

/** Verifica firma + expiración. Devuelve `{ sub }` o `null` si es inválido. */
export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && decoded !== null) {
      const sub = (decoded as jwt.JwtPayload).sub;
      if (typeof sub === 'string' && sub.length > 0) return { sub };
    }
    return null;
  } catch {
    return null;
  }
}
