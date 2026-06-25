/**
 * Augmentación propia (Etapa 0.5) del Request de Express.
 *
 * `request.authUser` ya está tipado en `src/authz/auth-user.types.ts` (no es
 * ownership de esta etapa). Aquí solo se añade `request.firebaseUid`, el `uid`
 * del usuario de Firebase tomado del token decodificado por `SessionMiddleware`,
 * que `AuthController` necesita para operar contra firebase-admin (p. ej.
 * cambiar la contraseña). Se mantiene en un campo separado para no tocar el
 * tipo `AuthUser` de otra etapa.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- punto de extensión oficial de @types/express
  namespace Express {
    interface Request {
      firebaseUid?: string;
    }
  }
}

export {};
