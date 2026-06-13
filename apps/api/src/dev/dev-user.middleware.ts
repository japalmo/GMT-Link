import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * SOLO PARA DESARROLLO.
 * Permite simular un usuario autenticado enviando el header `x-debug-user`
 * con el id del usuario, para probar el guard de permisos antes de que
 * exista la sesión real (Firebase Auth, Etapa 0.5). Desde 0.5 corre DESPUÉS de
 * `SessionMiddleware` y actúa solo como FALLBACK: nunca pisa una sesión real ya
 * resuelta (`req.authUser` ya seteado). En producción (NODE_ENV === 'production')
 * el header se ignora por completo.
 */
@Injectable()
export class DevUserMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (process.env.NODE_ENV !== 'production' && !req.authUser) {
      const debugUserId = req.header('x-debug-user');
      if (debugUserId) {
        req.authUser = { id: debugUserId };
      }
    }
    next();
  }
}
