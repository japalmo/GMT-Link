import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/** Recurso FGA sobre el que se evalúa el permiso. */
export interface PermissionResource {
  /** Tipo de objeto en el modelo OpenFGA (§4.3), ej. 'project'. */
  type: string;
  /** Nombre del parámetro de ruta que contiene el id del recurso, ej. 'projectId'. */
  param: string;
}

/** Metadata que `PermissionsGuard` lee para resolver el check contra OpenFGA. */
export interface PermissionMetadata {
  /** Relación / permiso atómico FGA (catálogo §8), ej. 'can_view'. */
  relation: string;
  resource: PermissionResource;
}

export const PERMISSION_METADATA_KEY = 'gtmlink:require_permission';

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
