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
        select: { id: true, email: true },
      });
      if (user) {
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
