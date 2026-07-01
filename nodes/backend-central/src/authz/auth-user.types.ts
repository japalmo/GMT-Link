/**
 * Usuario autenticado adjunto al request.
 * Hoy lo setea `DevUserMiddleware` (solo dev); en la Etapa 0.5 lo poblará
 * el middleware de sesión real (JWT propio).
 */
export interface AuthUser {
  id: string;
  email?: string;
}

/**
 * Augmentación tipada del Request de express para `request.authUser`.
 * Se declara sobre el namespace global `Express`, que es el punto de
 * extensión oficial de @types/express (`Request` extiende `Express.Request`),
 * de modo que el campo queda tipado en middlewares, guards y controllers.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- punto de extensión oficial de @types/express
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}
