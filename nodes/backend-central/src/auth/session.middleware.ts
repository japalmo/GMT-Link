import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { verifyToken } from '../common/jwt';
import './auth-request.types';

/**
 * Middleware de sesión (auth propia). Lee `Authorization: Bearer <jwt>`, verifica
 * NUESTRO JWT (firma + exp) y, si es válido, busca el `User` por id y setea
 * `req.authUser = { id, email }`. Token ausente/ inválido → sigue sin authUser
 * (fail-open; el guard responde 401 donde corresponda).
 *
 * Cuentas suspendidas (hallazgo A1): si el `User` está `SUSPENDED` NO se puebla
 * `authUser` (se trata como no autenticado), de modo que un token ya emitido deja
 * de dar acceso apenas se suspende la cuenta — sin depender de revocación de JWT.
 *
 * Revocación de sesión (A3): además se compara la época de sesión del token
 * (`payload.tokenVersion`) con la del usuario. Si difieren, el token fue revocado
 * (cambio de clave, revocación explícita) y NO se puebla `authUser`.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = SessionMiddleware.extractBearer(req.header('authorization'));
    if (!token) {
      next();
      return;
    }
    const payload = verifyToken(token);
    if (payload) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, status: true, tokenVersion: true },
      });
      // Cuenta inexistente o suspendida → no autenticar (corta tokens ya emitidos
      // a cuentas dadas de baja). Token revocado (tokenVersion desfasado) tampoco.
      // PENDING_FIRST_LOGIN/ACTIVE con la época vigente sí se pueblan.
      if (user && user.status !== 'SUSPENDED' && user.tokenVersion === payload.tokenVersion) {
        req.authUser = { id: user.id, email: user.email };
      }
    }
    next();
  }

  /** Extrae el token de un header "Bearer <token>"; null si no aplica. */
  private static extractBearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value;
  }
}
