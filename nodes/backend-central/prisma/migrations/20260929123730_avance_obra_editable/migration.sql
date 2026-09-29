-- Sobreescritura a mano del avance semanal.
--
-- NO se agrega ninguna columna de foto: las fotos de los cercos YA existen
-- como ProjectDocument colgado de la tarea, y el tablero ya las prefiere por
-- sobre la vista satelital (incluso elige la que corresponde a la semana que
-- se esta mirando). Lo que faltaba era una forma comoda de subirlas, no un
-- lugar donde guardarlas.

-- AlterTable
ALTER TABLE "project_weeks" ADD COLUMN     "acmRealOverride" DOUBLE PRECISION,
ADD COLUMN     "parRealOverride" DOUBLE PRECISION;

