-- Nuevo tipo de activo: maquinaria pesada (excavadoras, rodillos, etc.).
-- Aislado en su propia migración: Postgres no permite USAR un valor de enum recién
-- agregado en la misma transacción, así que el ADD VALUE va solo.
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'MAQUINARIA';
