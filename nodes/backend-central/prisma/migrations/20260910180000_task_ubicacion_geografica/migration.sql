-- Ubicación en terreno de una actividad de obra (WGS84).
-- El Cierre Perimetral tiene 63 cercos repartidos en 7,5 km de faena: sin
-- coordenadas no hay forma de mostrar en un mapa cuáles están listos, cuáles
-- faltan y dónde está trabajando la cuadrilla hoy.
-- Nullable: la mayoría de las actividades no son un punto en el terreno.
ALTER TABLE "tasks" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "tasks" ADD COLUMN "longitude" DOUBLE PRECISION;
