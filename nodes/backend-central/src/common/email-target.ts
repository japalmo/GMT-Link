/**
 * Resolución del correo de destino para flujos de credenciales/OTP. Fuente única
 * de verdad compartida por perfil (cambio de contraseña) y auth (recuperación de
 * contraseña): el código de recuperación DEBE emitirse y verificarse contra el
 * MISMO destino, de lo contrario el OTP nunca coincidiría.
 */

/** Forma mínima para resolver el destino del OTP de contraseña. */
export interface PasswordOtpTargetUser {
  email: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  emailInstitucionalVerified: Date | null;
  emailPersonalVerified: Date | null;
}

/**
 * Destino del OTP de contraseña: primer correo VERIFICADO en orden
 * (institucional -> personal); si ninguno está verificado, el `email` primario.
 */
export function resolvePasswordOtpTarget(user: PasswordOtpTargetUser): string {
  if (user.emailInstitucional && user.emailInstitucionalVerified) {
    return user.emailInstitucional;
  }
  if (user.emailPersonal && user.emailPersonalVerified) {
    return user.emailPersonal;
  }
  return user.email;
}

/** Forma mínima para resolver el correo primario (sin exigir verificación). */
export interface PrimaryEmailUser {
  email: string | null;
  emailInstitucional: string | null;
  emailPersonal: string | null;
}

/**
 * Correo primario del usuario (institucional > personal > compat), o '' si no
 * tiene ninguno. Se usa para REENVIAR la credencial provisoria a una cuenta que
 * aún no completa su primer ingreso (no exige verificación previa del correo).
 */
export function primaryEmail(user: PrimaryEmailUser): string {
  return (user.emailInstitucional ?? user.emailPersonal ?? user.email ?? '').trim();
}
