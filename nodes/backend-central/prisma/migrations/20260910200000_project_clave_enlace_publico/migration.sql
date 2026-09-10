-- Clave opcional del enlace público del proyecto.
-- Se guarda hasheada con bcrypt, igual que las claves de usuario: el enlace se
-- comparte con el cliente y una clave en claro en base sería un regalo.
-- Nullable a propósito: sin clave, el enlace sigue abierto como hasta ahora y
-- los que ya están circulando no se rompen.
ALTER TABLE "Project" ADD COLUMN "publicPasswordHash" TEXT;
