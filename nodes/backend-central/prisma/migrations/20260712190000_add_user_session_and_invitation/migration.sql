-- A3: época de sesión para revocar JWT antes de su expiración.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Gestión de invitación: marca del primer acceso completado (null = invitación no usada).
ALTER TABLE "User" ADD COLUMN "firstLoginAt" TIMESTAMP(3);
