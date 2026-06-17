import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/**
 * Recurso FGA evaluado por el guard, como UNIÓN DISCRIMINADA:
 *  - `{ type, param }`  → el id del recurso viene de un parámetro de ruta
 *    (caso original: project/document/asset por :id de la URL).
 *  - `{ type, id }`     → el id del recurso es ESTÁTICO (acciones org-scope sin
 *    param de ruta, p. ej. provisionar usuarios sobre `organization:gmt`, §1.1).
 * Exactamente una de las dos formas (no ambas): el discriminante es la presencia
 * de `param` vs `id`, así el guard sabe de dónde sacar el id sin ambigüedad.
 */
export type PermissionResource =
  | {
      /** Tipo de objeto en el modelo OpenFGA (§4.3), ej. 'project'. */
      type: string;
      /** Nombre del parámetro de ruta que contiene el id del recurso, ej. 'projectId'. */
      param: string;
      id?: never;
    }
  | {
      /** Tipo de objeto en el modelo OpenFGA (§4.3), ej. 'organization'. */
      type: string;
      /** Id estático del recurso (acciones org-scope), ej. ORG_ID. */
      id: string;
      param?: never;
    };

/** Metadata que `PermissionsGuard` lee para resolver el check contra OpenFGA. */
export interface PermissionMetadata {
  /** Relación / permiso atómico FGA (catálogo §8), ej. 'can_view'. */
  relation: string;
  resource: PermissionResource;
}

export const PERMISSION_METADATA_KEY = 'gmtlink:require_permission';

/**
 * Declara el permiso atómico FGA requerido para ejecutar el handler.
 * La decisión real la toma `PermissionsGuard` consultando OpenFGA (§3.1);
 * nunca se inspeccionan roles directamente.
 */
export const RequirePermission = (
  relation: string,
  resource: PermissionResource,
): CustomDecorator<string> =>
  SetMetadata<string, PermissionMetadata>(PERMISSION_METADATA_KEY, {
    relation,
    resource,
  });
