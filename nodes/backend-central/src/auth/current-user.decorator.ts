import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../authz/auth-user.types';

/**
 * Inyecta `request.authUser` (poblado por `SessionMiddleware`, con `DevUserMiddleware`
 * como fallback solo en dev) en un parámetro del handler.
 *
 * Devuelve `undefined` cuando no hay usuario autenticado: la decisión de
 * responder 401 queda en el handler (o, para rutas con permiso atómico, en
 * `PermissionsGuard`). El tipo de retorno es `AuthUser | undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.authUser;
  },
);
