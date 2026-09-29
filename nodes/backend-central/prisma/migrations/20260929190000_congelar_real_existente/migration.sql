-- Congela como SOBREESCRITURA el avance real que ya existe.
--
-- Hasta esta version, `parReal`/`acmReal` se cargaban a mano desde el informe
-- firmado; no salian de las actividades. Desde ahora, cualquier edicion
-- recalcula TODAS las semanas desde `project_activities.realByWeek`, y ahi el
-- detalle suele estar incompleto (en el Cierre Perimetral solo llega a S-1).
-- Sin este paso, la primera celda editada habria reemplazado S-2 (19,56%) y
-- S-3 (23,72%) por el valor de S-1 y el tablero habria caido de 23,7% a ~13%.
--
-- Registrarlo como sobreescritura describe exactamente lo que es —un valor
-- escrito a mano— y la pantalla lo muestra marcado, con el calculado al lado.
-- Cuando el detalle por actividad de una semana este cargado y coincida, se
-- quita la sobreescritura desde la tabla.
--
-- Va en la misma entrega que el recalculo, como migracion y no como script
-- aparte: asi no hay ventana entre desplegar y congelar en la que una edicion
-- pueda hundir el tablero. S-0 (index 0) es el arranque y queda fuera.
-- Idempotente: solo toca filas sin sobreescritura previa.

UPDATE "project_weeks"
SET "parRealOverride" = "parReal"
WHERE "index" >= 1
  AND "parReal" IS NOT NULL
  AND "parRealOverride" IS NULL;

UPDATE "project_weeks"
SET "acmRealOverride" = "acmReal"
WHERE "index" >= 1
  AND "acmReal" IS NOT NULL
  AND "acmRealOverride" IS NULL;
