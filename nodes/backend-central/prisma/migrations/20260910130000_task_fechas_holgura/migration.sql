-- Fechas tempranas y tardías del programa (CPM), por actividad.
--
-- Habilitan la banda temprana-tardía de la curva S. Sin ellas solo se puede
-- dibujar programada vs real, y no se distingue un atraso que consume holgura
-- de uno que ya empuja la fecha de término.
ALTER TABLE "tasks" ADD COLUMN "earlyStart"  TIMESTAMP(3),
                    ADD COLUMN "earlyFinish" TIMESTAMP(3),
                    ADD COLUMN "lateStart"   TIMESTAMP(3),
                    ADD COLUMN "lateFinish"  TIMESTAMP(3);
