import { Injectable } from '@nestjs/common';
import type { Permission } from '@prisma/client';
import type { PermissionCatalogGroup, PermissionCatalogItem } from '@gmt-platform/contracts';
import { FgaService } from '../../fga/fga.service';
import { PrismaService } from '../../prisma/prisma.service';
import { composable, fgaObjectTypeOf } from './composable-permissions';

/**
 * CRUD de roles dinámicos (RBAC dinámico, Fase 2 del diseño). Lee/escribe el
 * catálogo `Permission` y los roles `Role`+`RolePermission` de Postgres.
 * La sincronización hacia OpenFGA (`resyncRole`) es responsabilidad de
 * `FgaService` (stub en Fase 2, implementación real en Fase 3): este service
 * solo la INVOCA tras cambiar grants.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
  ) {}

  /**
   * Catálogo de permisos agrupado por módulo, con composable/fgaObjectType
   * resueltos. Orden (A14c, garantizado en código): módulos asc; dentro de
   * cada módulo STRUCTURAL antes que FUNCTIONAL; dentro de cada kind,
   * alfabético por label.
   */
  async listPermissions(): Promise<PermissionCatalogGroup[]> {
    const permissions = await this.prisma.permission.findMany();

    const itemsByModule = new Map<string, PermissionCatalogItem[]>();
    for (const permission of permissions) {
      const item = this.toCatalogItem(permission);
      const bucket = itemsByModule.get(permission.module);
      if (bucket === undefined) {
        itemsByModule.set(permission.module, [item]);
      } else {
        bucket.push(item);
      }
    }

    return [...itemsByModule.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([module, items]) => ({
        module,
        items: [...items].sort((a, b) => {
          if (a.kind !== b.kind) {
            return a.kind === 'STRUCTURAL' ? -1 : 1;
          }
          return a.label.localeCompare(b.label, 'es');
        }),
      }));
  }

  private toCatalogItem(permission: Permission): PermissionCatalogItem {
    return {
      key: permission.key,
      label: permission.label,
      module: permission.module,
      kind: permission.kind,
      scopeable: permission.scopeable,
      fgaObjectType: fgaObjectTypeOf(permission),
      composable: composable(permission),
    };
  }
}
