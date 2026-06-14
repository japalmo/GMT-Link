import { ConflictException, Injectable } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { FirebaseAuthError, getAuth } from 'firebase-admin/auth';
import type { DecodedIdToken } from 'firebase-admin/auth';

export type { DecodedIdToken };

/** Entrada para aprovisionar un usuario en Firebase (§1.1). */
export interface CreateFirebaseUserInput {
  email: string;
  password: string;
  /** Por defecto true: las cuentas las aprovisiona el admin ya verificadas (§1.1). */
  emailVerified?: boolean;
}

/**
 * Wrapper tipado sobre firebase-admin (§2).
 *
 * Inicialización idempotente: si el SDK ya tiene una app inicializada
 * (`getApps().length > 0`) la reutiliza; si no, llama a `initializeApp`.
 * El `projectId` sale de `FIREBASE_PROJECT_ID` (o 'demo-gtm-link' como
 * fallback de desarrollo). Si están las credenciales de service account
 * (`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`) se usan; de lo contrario
 * se inicializa sin credenciales (suficiente para el emulador).
 *
 * En dev, firebase-admin enruta TODA llamada al emulador automáticamente si la
 * variable de entorno `FIREBASE_AUTH_EMULATOR_HOST` está definida
 * (debe valer `localhost:9099`). No se configura aquí: el SDK la lee solo.
 */
@Injectable()
export class FirebaseService {
  private readonly app: App;

  constructor() {
    this.app = FirebaseService.resolveApp();
  }

  private static resolveApp(): App {
    const existing = getApps();
    if (existing.length > 0) {
      const [first] = existing;
      // getApps() devolvió al menos un elemento; el índice 0 existe.
      return first as App;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID ?? 'demo-gtm-link';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (clientEmail && privateKey) {
      return initializeApp({
        projectId,
        credential: cert({ projectId, clientEmail, privateKey }),
      });
    }

    // Sin service account (dev / emulador): el emulador no valida credenciales.
    return initializeApp({ projectId });
  }

  /** Verifica un ID token de Firebase y devuelve sus claims decodificados. */
  async verifyIdToken(token: string): Promise<DecodedIdToken> {
    return getAuth(this.app).verifyIdToken(token);
  }

  /** Cambia la contraseña del usuario de Firebase identificado por `uid`. */
  async setPassword(uid: string, password: string): Promise<void> {
    await getAuth(this.app).updateUser(uid, { password });
  }

  /**
   * Crea un usuario en Firebase (§1.1, provisión por admin).
   * `emailVerified` por defecto true: las cuentas las aprovisiona el admin y el
   * `SessionMiddleware` exige email verificado para derivar sesión.
   * Si el email ya existe lanza `ConflictException` con un mensaje claro
   * (Firebase responde `auth/email-already-exists`).
   */
  async createUser(input: CreateFirebaseUserInput): Promise<{ uid: string }> {
    try {
      const record = await getAuth(this.app).createUser({
        email: input.email,
        password: input.password,
        emailVerified: input.emailVerified ?? true,
      });
      return { uid: record.uid };
    } catch (error: unknown) {
      if (error instanceof FirebaseAuthError && error.code === 'auth/email-already-exists') {
        throw new ConflictException(
          `Ya existe una cuenta de Firebase con el email "${input.email}".`,
        );
      }
      throw error;
    }
  }

  /**
   * Borra un usuario de Firebase por `uid`. Best-effort: usado para compensar
   * (§1.1) cuando la creación en Postgres/FGA falla tras crear el usuario
   * Firebase. Si el usuario ya no existe se ignora el error.
   */
  async deleteUser(uid: string): Promise<void> {
    try {
      await getAuth(this.app).deleteUser(uid);
    } catch (error: unknown) {
      if (error instanceof FirebaseAuthError && error.code === 'auth/user-not-found') {
        return;
      }
      throw error;
    }
  }
}
