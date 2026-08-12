-- Visibilidad de un documento en la ficha PÚBLICA del activo.
--
-- La ficha pública se abre por QR sin autenticación, así que un documento no
-- debería aparecer ahí solo por estar cargado. Este flag lo hace explícito: cada
-- documento se muestra a propósito, desde la vista detalle.
--
-- Por defecto FALSE: tras la migración NINGÚN documento se ve en la ficha hasta
-- que alguien lo marque. Es el comportamiento seguro para una ruta pública; el
-- contrario (heredar la visibilidad actual) dejaría documentos sensibles
-- expuestos sin que nadie lo decidiera.
--
-- Migración ADITIVA: agrega una columna con default. No toca datos existentes.

ALTER TABLE "asset_documents" ADD COLUMN "visibleInFiche" BOOLEAN NOT NULL DEFAULT false;
