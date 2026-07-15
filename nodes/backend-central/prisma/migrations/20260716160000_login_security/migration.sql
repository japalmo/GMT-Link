-- #67 Seguridad de login: lockout de intentos por cuenta.
-- `failedLoginAttempts`: intentos fallidos consecutivos (se resetea al ingresar
-- correctamente o al recuperar la contraseña). `lockedUntil`: si es futuro, la
-- cuenta está bloqueada temporalmente. Ambos aditivos, con default seguro para
-- las filas existentes (0 intentos, sin bloqueo).
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- #66 Recuperación de contraseña: marca de tiempo de la última recuperación
-- iniciada, para aplicar un cooldown por cuenta que limita el reenvío/rotación de
-- credencial y el envío de OTP (anti email-bombing y anti-DoS de credencial), sin
-- depender del throttle por IP.
ALTER TABLE "User" ADD COLUMN "lastRecoveryAt" TIMESTAMP(3);
