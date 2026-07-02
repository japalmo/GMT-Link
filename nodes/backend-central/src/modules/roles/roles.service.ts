import { BadRequestException, Injectable } from '@nestjs/common';
import type { Permission, Role } from '@prisma/client';
import type {
  CreateRoleInput,
  PermissionCatalogGroup,
  PermissionCatalogItem,
  RoleDetail,
  RoleGrant,
} from '@gmt-platform/contracts';
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

  /**
   * Crea un rol CUSTOM (`isSystem=false`) a partir de label + grants
   * (`grants: []` es válido, A6). `createdById: null` = sin admin atribuible
   * (p. ej. clonación, Task 2.11). Role + RolePermission[] se crean en un
   * único write anidado de Prisma (transaccional).
   */
  async createRole(input: CreateRoleInput, createdById: string | null): Promise<RoleDetail> {
    await this.validateGrants(input.grants);
    const key = await this.slugKey(input.label);

    const role = await this.prisma.role.create({
      data: {
        key,
        label: input.label,
        description: input.description ?? null,
        isSystem: false,
        createdById,
        permissions: {
          create: input.grants.map((grant) => ({
            scope: grant.scope,
            permission: { connect: { key: grant.permissionKey } },
          })),
        },
      },
    });

    return this.toRoleDetail(role);
  }

  /** Detalle de un rol por key. 404 si no existe (placeholder Task 2.7). */
  async getRole(key: string): Promise<RoleDetail> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { key } });
    return this.toRoleDetail(role);
  }

  /** Arma el `RoleDetail` de un rol ya cargado (resuelve sus grants). */
  private async toRoleDetail(
    role: Pick<Role, 'id' | 'key' | 'label' | 'description' | 'isSystem'>,
  ): Promise<RoleDetail> {
    const grantsRaw = await this.prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    });
    const grants = grantsRaw.map((g) => ({ permissionKey: g.permission.key, scope: g.scope }));
    return {
      key: role.key,
      label: role.label,
      description: role.description,
      isSystem: role.isSystem,
      allowedScopeTypes: this.allowedScopeTypes(grants),
      grants,
    };
  }

  /** Placeholder: la lógica real (['PROJECT'] si hay STRUCTURAL project-level) llega en la Task 2.9. */
  allowedScopeTypes(
    _grants: ReadonlyArray<{ permissionKey: string; scope: string }>,
  ): ('ORGANIZATION' | 'PROJECT')[] {
    return ['ORGANIZATION'];
  }

  /**
   * Valida un array de grants antes de persistirlo (`[]` pasa trivialmente, A6):
   *  0. sin `permissionKey` repetidas (el PK compuesto [roleId, permissionId]
   *     lo haría reventar con P2002→500; y repetir con scopes distintos es una
   *     contradicción que el cliente debe ver, no dedupear en silencio) → 400
   *     DUPLICATE_GRANT,
   *  1. cada `permissionKey` existe en el catálogo,
   *  2. es `composable` (FUNCTIONAL siempre; STRUCTURAL solo si está en
   *     `COMPOSABLE_STRUCTURAL`), y si no lo es → 400 NOT_COMPOSABLE,
   *  3. si el permiso NO es `scopeable`, el scope del grant debe ser 'GLOBAL'
   *     (si no → 400 NOT_COMPOSABLE, mismo code: el grant no es válido para
   *     ese permiso),
   *  4. los permisos STRUCTURAL del set deben ser homogéneos en su nivel FGA
   *     (todos 'organization' o todos 'project'; mezclarlos → 400
   *     MIXED_SCOPE_LEVELS). Los FUNCTIONAL no participan de esta regla.
   */
  private async validateGrants(grants: readonly RoleGrant[]): Promise<void> {
    const keys = grants.map((g) => g.permissionKey);

    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        throw new BadRequestException({
          code: 'DUPLICATE_GRANT',
          message: `El permiso "${key}" está repetido en los grants.`,
        });
      }
      seen.add(key);
    }

    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(permissions.map((p) => [p.key, p]));

    const structuralLevels = new Set<'organization' | 'project'>();

    for (const grant of grants) {
      const permission = byKey.get(grant.permissionKey);
      if (!permission || !composable(permission)) {
        throw new BadRequestException({
          code: 'NOT_COMPOSABLE',
          message: `El permiso "${grant.permissionKey}" no existe o no puede incluirse en un rol custom.`,
        });
      }
      if (!permission.scopeable && grant.scope !== 'GLOBAL') {
        throw new BadRequestException({
          code: 'NOT_COMPOSABLE',
          message: `El permiso "${grant.permissionKey}" no admite scope: debe ir con scope GLOBAL.`,
        });
      }
      if (permission.kind === 'STRUCTURAL') {
        const objectType = fgaObjectTypeOf(permission);
        if (objectType) {
          structuralLevels.add(objectType);
        }
      }
    }

    if (structuralLevels.size > 1) {
      throw new BadRequestException({
        code: 'MIXED_SCOPE_LEVELS',
        message:
          'Los permisos estructurales del rol deben ser todos de organización o todos de proyecto, no una mezcla.',
      });
    }
  }

  /**
   * Deriva una `key` única tipo `c_<slug>` desde `label`: minúsculas, sin
   * acentos, `[^a-z0-9]`→`_`, colapsa `_` repetidos, recorta a 40 chars. Si
   * colisiona con una key existente agrega sufijo `_2`, `_3`, ...
   */
  private async slugKey(label: string): Promise<string> {
    const base = this.slugify(label);
    const existing = await this.prisma.role.findMany({ select: { key: true } });
    const existingKeys = new Set(existing.map((r) => r.key));

    if (!existingKeys.has(base)) {
      return base;
    }
    let suffix = 2;
    let candidate = this.withSuffix(base, suffix);
    while (existingKeys.has(candidate)) {
      suffix += 1;
      candidate = this.withSuffix(base, suffix);
    }
    return candidate;
  }

  private slugify(label: string): string {
    const normalized = label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos/diacríticos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    // Label solo-símbolos/emoji → slug vacío; sin fallback la key degeneraría
    // en 'c' (perdería el prefijo 'c_').
    const slug = normalized === '' ? 'rol' : normalized;
    const withPrefix = `c_${slug}`;
    return withPrefix.slice(0, 40).replace(/_+$/g, '');
  }

  private withSuffix(base: string, suffix: number): string {
    const suffixStr = `_${suffix}`;
    const trimmed = base.slice(0, 40 - suffixStr.length).replace(/_+$/g, '');
    return `${trimmed}${suffixStr}`;
  }
}
