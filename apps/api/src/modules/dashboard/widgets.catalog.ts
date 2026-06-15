import { ORG_ID, ORG_OBJECT_TYPE } from '../../common/org.constant';

/**
 * Permiso FGA que condiciona la visibilidad de un widget. Si está presente, el
 * service consulta `FgaService.check({ user, relation, object: type:id })` y solo
 * incluye el widget cuando el usuario lo puede ver. Los widgets sin permiso van
 * siempre.
 */
export interface WidgetPermission {
  /** Relación / permiso atómico FGA (catálogo §8), ej. 'can_manage_users'. */
  relation: string;
  /** Tipo de objeto en el modelo OpenFGA (§4.3), ej. 'organization'. */
  type: string;
  /** Id del recurso, ej. ORG_ID. */
  id: string;
}

/**
 * Definición de un widget disponible (catálogo). El DATO del widget lo calcula
 * el frontend reusando endpoints existentes; aquí solo se gestiona el catálogo
 * y, si aplica, el permiso requerido para verlo.
 */
export interface WidgetDefinition {
  /** Identificador estable del widget (clave de layout y de catálogo). */
  key: string;
  title: string;
  description: string;
  /** Permiso requerido para ver el widget; ausente = visible para todos. */
  permission?: WidgetPermission;
}

/**
 * Catálogo de widgets disponibles del dashboard (§6-2.1). El orden de este array
 * es el orden por defecto del layout cuando el usuario no tiene config guardada.
 *
 * `usuarios-total` requiere `can_manage_users` sobre `organization:gmt` —
 * consistente con el gating del módulo de usuarios (§6-1.1). El resto son
 * visibles para todos (su contenido ya se filtra/scopea en sus propios endpoints).
 */
export const WIDGET_CATALOG: readonly WidgetDefinition[] = [
  {
    key: 'usuarios-total',
    title: 'Usuarios',
    description: 'Total de usuarios de la organización.',
    permission: { relation: 'can_manage_users', type: ORG_OBJECT_TYPE, id: ORG_ID },
  },
  {
    key: 'directorio',
    title: 'Directorio',
    description: 'Acceso rápido al directorio de personas.',
  },
  {
    key: 'mis-documentos-por-vencer',
    title: 'Mis documentos por vencer',
    description: 'Documentos personales que vencen en los próximos 30 días.',
  },
  {
    key: 'mi-cv',
    title: 'Mi CV',
    description: 'Resumen de tu hoja de vida y accesos directos.',
  },
  {
    key: 'flota-resumen',
    title: 'Flota',
    description: 'Resumen de vehículos (placeholder).',
  },
] as const;
