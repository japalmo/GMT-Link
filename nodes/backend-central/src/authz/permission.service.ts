import { Inject, Injectable } from '@nestjs/common';
import type { Membership } from '@prisma/client';
import type {
  PermissionDecision,
  ResourceRef,
  ScopeFilter,
} from '@gmt-platform/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { FgaService } from '../fga/fga.service';

/** Token DI para la lista de IDs de SuperAdmin (cortocircuitan toda decisión, ADR-0001). */
export const SUPER_ADMIN_IDS = Symbol('SUPER_ADMIN_IDS');

/**
 * Permiso "meta": acceso completo (como admin) con banner beta en el front.
 * Lo llevan las gerencias (gerencia_general / gerencia_rh) durante la beta. Concede
 * GLOBAL sobre todo el catálogo funcional (equivalente a SuperAdmin salvo que el front
 * muestra el banner). El enforcement fino STRUCTURAL/FGA de proyectos (Fase 2) se
 * cortocircuita igual que para SuperAdmin: acceso total mientras dure la beta.
 */
const BETA_FULL_KEY = 'system:beta:full';

/**
 * Fachada única de autorización del Módulo 4 (ADR-0001) — el ÚNICO punto de decisión.
 *
 * Resuelve "¿puede el usuario X ejercer el permiso K (sobre el recurso R)?" a partir
 * de los grants funcionales en Postgres (`Role → RolePermission.scope`) y, para los
 * permisos `STRUCTURAL`, delegando la parte de proyecto en OpenFGA (hereda la jerarquía
 * depto→proyecto). El scope "Solo propios" es SIEMPRE un predicado de fila (`createdById`),
 * inexpresable en ReBAC. Además devuelve un `ScopeFilter` para que las LISTAS se filtren
 * server-side: un `projectId` manipulado en el body solo se intersecta, nunca amplía.
 */
@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    @Inject(SUPER_ADMIN_IDS) private readonly superAdminIds: string[],
  ) {}

  /** Filtro de scope para LISTAS. `null` = el usuario no tiene el permiso (denegado). */
  async scopeFilter(userId: string, permissionKey: string): Promise<ScopeFilter | null> {
    if (this.superAdminIds.includes(userId)) return { kind: 'none' };

    const memberships = await this.prisma.membership.findMany({ where: { userId } });
    if (memberships.length === 0) return null;

    // `system:beta:full` = acceso completo con banner: GLOBAL sobre todo el catálogo.
    if (await this.hasBetaFull(memberships)) return { kind: 'none' };

    const roleKeys = [...new Set(memberships.map((m) => m.roleKey))];
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { key: { in: roleKeys } }, permission: { key: permissionKey } },
    });
    if (grants.length === 0) return null;

    // Gana el scope más fuerte: GLOBAL > PROJECT > OWN.
    if (grants.some((g) => g.scope === 'GLOBAL')) return { kind: 'none' };
    if (grants.some((g) => g.scope === 'PROJECT')) {
      return { kind: 'projects', ids: await this.projectIdsForUser(memberships) };
    }
    return { kind: 'own' };
  }

  /** Decisión para UN recurso. El filtro se aplica además al query, nunca al body del cliente. */
  async can(userId: string, permissionKey: string, resource?: ResourceRef): Promise<PermissionDecision> {
    const filter = await this.scopeFilter(userId, permissionKey);
    if (filter === null) return { effect: 'deny', filter: { kind: 'none' } };
    if (resource === undefined || filter.kind === 'none') return { effect: 'allow', filter };
    if (filter.kind === 'own') {
      return { effect: resource.createdById === userId ? 'allow' : 'deny', filter };
    }

    // filter.kind === 'projects'
    if (resource.projectId === undefined) return { effect: 'deny', filter };
    const permission = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (permission?.kind === 'STRUCTURAL' && permission.fgaRelation) {
      const ok = await this.fga.check({
        user: `user:${userId}`,
        relation: permission.fgaRelation,
        object: `project:${resource.projectId}`,
      });
      return { effect: ok ? 'allow' : 'deny', filter };
    }
    return { effect: filter.ids.includes(resource.projectId) ? 'allow' : 'deny', filter };
  }

  /**
   * Usuarios que pueden ejercer `permissionKey` en `projectId` (dropdown de autorizador, M3).
   * B-ahora: vía `Membership` (espejo Postgres). C-luego: `fga.listUsers` con herencia.
   */
  async usersWithPermissionOnProject(permissionKey: string, projectId: string): Promise<string[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { permission: { key: permissionKey } },
      include: { role: true },
    });
    const roleKeys = [...new Set(grants.map((g) => g.role.key))];
    if (roleKeys.length === 0) return [];
    const memberships = await this.prisma.membership.findMany({
      where: { roleKey: { in: roleKeys }, scopeType: 'PROJECT', scopeId: projectId },
    });
    return [...new Set(memberships.map((m) => m.userId))];
  }

  /**
   * Claves de permiso EFECTIVAS del usuario (union de los grants de todos sus
   * roles, cualquier scope). Lectura coarse para el gating de UI (`GET /auth/me`)
   * — el enforcement fino (OWN/PROJECT/STRUCTURAL→FGA) sigue en `can`/`scopeFilter`.
   * SuperAdmin (env) recibe TODO el catálogo. Sin memberships → `[]`.
   */
  async permissionKeysForUser(userId: string): Promise<string[]> {
    if (this.superAdminIds.includes(userId)) {
      const all = await this.prisma.permission.findMany({ select: { key: true } });
      return all.map((p) => p.key);
    }
    const memberships = await this.prisma.membership.findMany({ where: { userId } });
    if (memberships.length === 0) return [];
    // `system:beta:full` (gerencias): acceso completo → todo el catálogo (con banner en el front).
    if (await this.hasBetaFull(memberships)) {
      const all = await this.prisma.permission.findMany({ select: { key: true } });
      return all.map((p) => p.key);
    }
    const roleKeys = [...new Set(memberships.map((m) => m.roleKey))];
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { key: { in: roleKeys } } },
      include: { permission: { select: { key: true } } },
    });
    return [...new Set(grants.map((row) => row.permission.key))];
  }

  /** ¿Alguno de los roles del usuario otorga `system:beta:full` (acceso completo con banner)? */
  private async hasBetaFull(memberships: Membership[]): Promise<boolean> {
    if (memberships.length === 0) return false;
    const roleKeys = [...new Set(memberships.map((m) => m.roleKey))];
    const grant = await this.prisma.rolePermission.findFirst({
      where: { role: { key: { in: roleKeys } }, permission: { key: BETA_FULL_KEY } },
      select: { roleId: true },
    });
    return grant != null;
  }

  /** Proyectos "asociados" al usuario: membresías PROJECT directas + expansión de DEPARTMENT. */
  private async projectIdsForUser(memberships: Membership[]): Promise<string[]> {
    const direct = memberships.filter((m) => m.scopeType === 'PROJECT').map((m) => m.scopeId);
    const deptIds = memberships.filter((m) => m.scopeType === 'DEPARTMENT').map((m) => m.scopeId);
    let deptProjects: string[] = [];
    if (deptIds.length > 0) {
      const rows = await this.prisma.project.findMany({
        where: { departmentId: { in: deptIds } },
        select: { id: true },
      });
      deptProjects = rows.map((r) => r.id);
    }
    return [...new Set([...direct, ...deptProjects])];
  }
}
