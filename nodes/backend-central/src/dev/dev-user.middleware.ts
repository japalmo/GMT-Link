import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * SOLO PARA DESARROLLO.
 * Permite simular un usuario autenticado enviando el header `x-debug-user`
 * con el id del usuario, para probar el guard de permisos sin un idToken real.
 * Corre DESPUÉS de `SessionMiddleware` y actúa solo como FALLBACK: nunca pisa una
 * sesión real ya resuelta (`req.authUser` ya seteado).
 *
 * GATE DE SEGURIDAD (fail-closed): se activa SOLO con `NODE_ENV === 'development'`
 * EXPLÍCITO. En cualquier otro entorno (production, staging, CI, o NODE_ENV
 * ausente) el header se ignora por completo — así un despliegue no marcado como
 * dev nunca permite suplantar a un admin vía `x-debug-user`. Ahora que existen
 * endpoints reales de provisión (`can_manage_users`), este endurecimiento importa.
 */
@Injectable()
export class DevUserMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (process.env.NODE_ENV === 'development' && !req.authUser) {
      const debugUserId = req.header('x-debug-user');
      if (debugUserId) {
        req.authUser = { id: debugUserId };
      }
    }
    next();
  }
}
