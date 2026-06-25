import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import './auth-request.types';

/**
 * Middleware de sesión real (Etapa 0.5, §6-0.5).
 *
 * Lee el header `Authorization: Bearer <idToken>`. Si existe:
 *  1. verifica el token con Firebase (`FirebaseService.verifyIdToken`);
 *  2. busca el `User` de Postgres por email (la identidad Firebase se vincula
 *     POR EMAIL — `User.email` es @unique en §4.2);
 *  3. si el usuario existe, setea `request.authUser = { id, email }` y
 *     `request.firebaseUid = <uid del token>`.
 *
 * Token ausente, inválido, o sin usuario espejo en Postgres → NO setea nada y
 * deja pasar: el `PermissionsGuard` responderá 401 en las rutas que lo exijan.
 * Por eso ningún error de verificación se propaga: se traga silenciosamente.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = SessionMiddleware.extractBearer(req.header('authorization'));
    if (!token) {
      next();
      return;
    }

    try {
      const decoded = await this.firebase.verifyIdToken(token);
      const email = decoded.email;
      // Endurecimiento (§3 mínimo privilegio): solo derivamos sesión si Firebase
      // confirma el email. Las cuentas las aprovisiona el admin (§1.1) con
      // emailVerified=true; exigirlo evita que un token de un email arbitrario
      // (provider password sin verificar) suplante a un User espejo de Postgres.
      if (email && decoded.email_verified === true) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (user) {
          req.authUser = { id: user.id, email: user.email };
          req.firebaseUid = decoded.uid;
        }
      }
    } catch {
      // Token inválido/expirado: se ignora; el request sigue sin authUser.
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
