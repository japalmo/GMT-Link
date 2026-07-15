-- Secciones (páginas) de una plantilla de checklist. Aditiva y nullable:
-- arreglo de { id, title, description? } serializado como JSONB. null/ausente = sin secciones.
-- El campo `section` de cada ítem vive dentro del Json de `items`, no necesita columna.
ALTER TABLE "checklist_templates" ADD COLUMN "sections" JSONB;
