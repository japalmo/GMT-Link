import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Permission, Role } from '@prisma/client';
import type {
  CloneRoleResponse,
  CreateRoleInput,
  PermissionCatalogGroup,
  PermissionCatalogItem,
  RoleDetail,
  RoleGrant,
  ScopeType,
  UpdateRoleInput,
} from '@gmt-platform/contracts';
import { FgaService } from '../../fga/fga.service';
import { PrismaService } from '../../prisma/prisma.service';
import { COMPOSABLE_STRUCTURAL, composable, fgaObjectTypeOf } from './composable-permissions';

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

    return this.toRoleDetail(role, await this.loadGrants(role.id));
  }

  /** Todos los roles (sistema + custom) con sus grants, en UNA query (join, sin N+1). */
  async listRoles(): Promise<RoleDetail[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
    return roles.map((role) => this.toRoleDetail(role, role.permissions));
  }

  /** Detalle de un rol por key. 404 si no existe. */
  async getRole(key: string): Promise<RoleDetail> {
    const role = await this.findRoleOrThrow(key);
    return this.toRoleDetail(role, await this.loadGrants(role.id));
  }

  /**
   * Implementación CANÓNICA de updateRole (A2 — la Fase 3 no la reescribe).
   * Actualiza label/description/grants de un rol CUSTOM. 403 si `isSystem`.
   * - `input.grants === undefined` → update simple de label/description,
   *   SIN transacción de grants y SIN `fga.resyncRole`.
   * - `input.grants` definido (incluso `[]`) → valida y REEMPLAZA el set
   *   completo (deleteMany+createMany) dentro de `$transaction`, y luego llama
   *   `fga.resyncRole(key)` para que se reconcilien las tuplas FGA de todos
   *   los usuarios con este rol (stub en Fase 2, real en Fase 3).
   * - Si `resyncRole` lanza: restaura los grants previos en Postgres, reintenta
   *   `resyncRole` best-effort con los grants viejos y responde
   *   502 {code:'FGA_SYNC_FAILED'}.
   */
  async updateRole(key: string, input: UpdateRoleInput): Promise<RoleDetail> {
    const role = await this.findRoleOrThrow(key);
    if (role.isSystem) {
      throw new ForbiddenException(`El rol "${key}" es del sistema y no se puede editar.`);
    }

    const labelDescriptionData = {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    };

    const newGrants = input.grants;
    if (newGrants === undefined) {
      // Solo label/description: no cambia el set de grants → no hay nada que
      // sincronizar en FGA (A2).
      const updated = await this.prisma.role.update({
        where: { id: role.id },
        data: labelDescriptionData,
      });
      return this.toRoleDetail(updated, await this.loadGrants(role.id));
    }

    await this.validateGrants(newGrants);

    // Filas crudas previas (roleId/permissionId/scope) para poder restaurar si FGA falla.
    const previousRows = (
      await this.prisma.rolePermission.findMany({ where: { roleId: role.id } })
    ).map((row) => ({ roleId: row.roleId, permissionId: row.permissionId, scope: row.scope }));
    const newRows = await this.grantsToRolePermissionRows(role.id, newGrants);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedRole = await tx.role.update({ where: { id: role.id }, data: labelDescriptionData });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: newRows });
      return updatedRole;
    });

    try {
      await this.fga.resyncRole(key);
    } catch {
      // Rollback: restaurar los grants previos en Postgres…
      await this.prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({ data: previousRows });
      });
      // …y reintentar la sincronización FGA con los grants viejos (best-effort:
      // si también falla, Postgres ya quedó consistente con el estado previo).
      try {
        await this.fga.resyncRole(key);
      } catch {
        // best-effort intencional
      }
      throw new BadGatewayException({
        code: 'FGA_SYNC_FAILED',
        message: 'No se pudo sincronizar el rol con OpenFGA; se restauraron los permisos previos.',
      });
    }

    return this.toRoleDetail(updated, await this.loadGrants(role.id));
  }

  /**
   * Borra un rol CUSTOM. 403 si `isSystem`. 409 {code:'ROLE_IN_USE'} si tiene
   * al menos una `Membership` con ese `roleKey` (cualquier scope): borrarlo
   * dejaría usuarios con un rol fantasma. El admin debe reasignar/quitar el
   * rol de esos usuarios antes de poder eliminarlo.
   */
  async deleteRole(key: string): Promise<void> {
    const role = await this.findRoleOrThrow(key);
    if (role.isSystem) {
      throw new ForbiddenException(`El rol "${key}" es del sistema y no se puede eliminar.`);
    }

    const membershipCount = await this.prisma.membership.count({ where: { roleKey: key } });
    if (membershipCount > 0) {
      throw new ConflictException({
        code: 'ROLE_IN_USE',
        message: `El rol "${key}" está asignado a ${membershipCount} usuario(s) y no se puede eliminar.`,
      });
    }

    await this.prisma.role.delete({ where: { id: role.id } });
  }

  /**
   * Clona un rol EXISTENTE (sistema o custom) como rol CUSTOM nuevo con
   * `label` propio (A7, spec §6.2/§13.4). Filosofía A7: FILTRAR, no fallar.
   * Se omiten del clon (y se devuelven en `omittedPermissionKeys` para que la
   * UI los avise):
   *  1. los grants NO componibles (STRUCTURAL fuera de
   *     `COMPOSABLE_STRUCTURAL`, p. ej. `document:sign:qa` del rol 'qa'
   *     sembrado), y
   *  2. si los STRUCTURAL componibles restantes mezclan niveles FGA
   *     'organization' y 'project' (caso `org_admin`), los de nivel ORG: el
   *     clon conserva los de PROJECT — precedencia consistente con
   *     `allowedScopeTypes` — en vez de reventar con 400 MIXED_SCOPE_LEVELS
   *     en `validateGrants`.
   * Los FUNCTIONAL se clonan siempre (no participan de niveles FGA). Si todos
   * se omiten, el clon queda con `grants: []` (válido por A6). Atribución: el
   * clon nace con `createdById = actorId` (el admin que clona) — nunca hereda
   * el del origen ni queda en null-de-semilla.
   */
  async cloneRole(key: string, label: string, actorId: string | null): Promise<CloneRoleResponse> {
    const source = await this.findRoleOrThrow(key);
    const sourceGrantsRaw = await this.loadGrants(source.id);

    const omittedPermissionKeys: string[] = [];
    const composableRaw: typeof sourceGrantsRaw = [];
    for (const grantRaw of sourceGrantsRaw) {
      if (composable(grantRaw.permission)) {
        composableRaw.push(grantRaw);
      } else {
        omittedPermissionKeys.push(grantRaw.permission.key);
      }
    }

    // Homogeneización de niveles FGA: si hay mezcla org+project entre los
    // componibles, los org-level también se omiten (ver docstring, punto 2).
    const mixedLevels =
      composableRaw.some((g) => fgaObjectTypeOf(g.permission) === 'organization') &&
      composableRaw.some((g) => fgaObjectTypeOf(g.permission) === 'project');

    const grants: RoleGrant[] = [];
    for (const grantRaw of composableRaw) {
      if (mixedLevels && fgaObjectTypeOf(grantRaw.permission) === 'organization') {
        omittedPermissionKeys.push(grantRaw.permission.key);
      } else {
        grants.push({ permissionKey: grantRaw.permission.key, scope: grantRaw.scope });
      }
    }

    const role = await this.createRole(
      { label, description: source.description ?? undefined, grants },
      actorId,
    );
    return { role, omittedPermissionKeys };
  }

  /** Traduce RoleGrant[] a filas de RolePermission (resuelve permissionId por key). */
  private async grantsToRolePermissionRows(
    roleId: string,
    grants: readonly RoleGrant[],
  ): Promise<Array<{ roleId: string; permissionId: string; scope: RoleGrant['scope'] }>> {
    const keys = grants.map((g) => g.permissionKey);
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
    return grants.map((grant) => ({
      roleId,
      permissionId: idByKey.get(grant.permissionKey) as string,
      scope: grant.scope,
    }));
  }

  /**
   * Rol por key o 404. Solo la AUSENCIA de fila es 404: cualquier otro error
   * (BD caída, timeout, etc.) se propaga tal cual — no se disfraza de
   * "rol no existe".
   */
  private async findRoleOrThrow(key: string): Promise<Role> {
    const role = await this.prisma.role.findUnique({ where: { key } });
    if (!role) {
      throw new NotFoundException(`No existe un rol con key "${key}".`);
    }
    return role;
  }

  /** Filas RolePermission (+Permission) de un rol, para armar sus grants. */
  private async loadGrants(roleId: string) {
    return this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
  }

  /** Arma el `RoleDetail` de un rol con sus grants ya cargados (sin queries). */
  private toRoleDetail(
    role: Pick<Role, 'key' | 'label' | 'description' | 'isSystem'>,
    grantsRaw: ReadonlyArray<{ permission: { key: string }; scope: RoleGrant['scope'] }>,
  ): RoleDetail {
    const grants: RoleGrant[] = grantsRaw.map((g) => ({
      permissionKey: g.permission.key,
      scope: g.scope,
    }));
    return {
      key: role.key,
      label: role.label,
      description: role.description,
      isSystem: role.isSystem,
      allowedScopeTypes: this.allowedScopeTypes(grants),
      grants,
    };
  }

  /**
   * ['PROJECT'] si algún grant coincide con un permiso STRUCTURAL project-level
   * del mapa `COMPOSABLE_STRUCTURAL`; si no, ['ORGANIZATION'] (incluye el caso
   * sin grants — `[]` es un rol recién creado por el flujo A6 —, solo
   * FUNCTIONAL, o STRUCTURAL org-level). Los permisos FUNCTIONAL no participan
   * de este cálculo: no acotan el scope asignable del rol.
   */
  allowedScopeTypes(grants: readonly RoleGrant[]): ScopeType[] {
    const hasProjectLevel = grants.some(
      (grant) => COMPOSABLE_STRUCTURAL[grant.permissionKey] === 'project',
    );
    return hasProjectLevel ? ['PROJECT'] : ['ORGANIZATION'];
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
