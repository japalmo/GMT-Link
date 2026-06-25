/**
 * Organización única (§2 "instancia única con clientes scopeados").
 * Todo el tenant GMT vive bajo `organization:gmt` en OpenFGA; el admin de la
 * organización es `organization#admin` sobre `organization:gmt`. Las acciones
 * org-scope (provisionar usuarios, §1.1) se evalúan contra este id estático.
 */
export const ORG_ID = 'gmt';

/** Tipo de objeto OpenFGA de la organización (§4.3). */
export const ORG_OBJECT_TYPE = 'organization';
