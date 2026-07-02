import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FGA_CLIENT,
  MEMBERSHIP_RELATION_MAP,
  SCOPE_OBJECT_TYPE,
} from './fga.types';
import type {
  FgaClientLike,
  MembershipInput,
  MembershipSyncOp,
  TupleKey,
} from './fga.types';
import { PrismaService } from '../prisma/prisma.service';
import { COMPOSABLE_STRUCTURAL } from '../modules/roles/composable-permissions';
import { ORG_ID } from '../common/org.constant';

/** Scopes admitidos para asignaciones de roles custom (matriz RBAC). */
type AssignableScopeType = 'ORGANIZATION' | 'PROJECT';

/** Asignación (usuario, rol, scope) a sincronizar con FGA. */
interface RoleAssignmentInput {
  userId: string;
  roleKey: string;
  scopeType: AssignableScopeType;
  scopeId: string;
}

/** Forma del grant que consumen estos métodos (evita `any`). */
interface StructuralGrant {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

/** organization:gmt | project:<scopeId> según el scope de la asignación. */
function objectOf(
  scopeType: AssignableScopeType,
  scopeId: string,
): { objectType: 'organization' | 'project'; object: string } {
  return scopeType === 'ORGANIZATION'
    ? { objectType: 'organization', object: `organization:${ORG_ID}` }
    : { objectType: 'project', object: `project:${scopeId}` };
}

/** Clave canónica de tupla para sets de dedupe/unión (enmienda A5). */
function tupleId(t: TupleKey): string {
  return `${t.user}|${t.relation}|${t.object}`;
}

/**
 * Punto único de decisión de autorización (§3.1, §4.1).
 * Envuelve el cliente OpenFGA (inyectado vía `FGA_CLIENT`) y expone el contrato
 * que consumen el guard (0.4) y los módulos de negocio. La sincronización
 * Postgres→OpenFGA (`syncMembershipToFGA`) mantiene las tuplas en línea con las
 * `Membership` del espejo legible (§4.1).
 */
@Injectable()
export class FgaService {
  constructor(
    @Inject(FGA_CLIENT) private readonly client: FgaClientLike,
    private readonly prisma: PrismaService,
  ) {}

  private readonly logger = new Logger(FgaService.name);

  /**
   * Reconcilia las tuplas FGA de TODOS los usuarios que tienen `roleKey`
   * asignado: el set deseado por (usuario, objeto) es la UNIÓN de los grants
   * STRUCTURAL de todos sus roles custom sobre ese objeto (A5).
   *
   * STUB en Fase 2 (A2): no-op para que `RolesService.updateRole` compile y
   * se pueda testear el contrato de invocación/rollback. La Fase 3 REEMPLAZA
   * este cuerpo por la implementación real (Modify, no Create).
   */
  async resyncRole(roleKey: string): Promise<void> {
    this.logger.warn(`resyncRole('${roleKey}'): stub, se implementa en Fase 3`);
  }

  /** ¿Puede `user` ejercer `relation` sobre `object`? Resuelto en OpenFGA. */
  async check(params: { user: string; relation: string; object: string }): Promise<boolean> {
    const response = await this.client.check(params);
    return response.allowed === true;
  }

  /** Escribe tuplas (idempotente desde la perspectiva del llamador: lista vacía = no-op). */
  async writeTuples(tuples: TupleKey[]): Promise<void> {
    if (tuples.length === 0) return;
    await this.client.write({ writes: tuples });
  }

  /** Borra tuplas (lista vacía = no-op). */
  async deleteTuples(tuples: TupleKey[]): Promise<void> {
    if (tuples.length === 0) return;
    await this.client.write({ deletes: tuples });
  }

  /**
   * Sincroniza una `Membership` de Postgres hacia OpenFGA (§4.1).
   * El mapeo roleKey+scopeType→relación vive en `MEMBERSHIP_RELATION_MAP` (§4.3).
   * Combinación no contemplada → error (no se escribe una tupla ambigua).
   */
  async syncMembershipToFGA(membership: MembershipInput, op: MembershipSyncOp): Promise<void> {
    const tuple = this.membershipToTuple(membership);
    if (op === 'create') {
      await this.writeTuples([tuple]);
    } else {
      await this.deleteTuples([tuple]);
    }
  }

  /** Traduce una membresía a su tupla FGA según el mapeo §4.3. */
  private membershipToTuple(membership: MembershipInput): TupleKey {
    const relationByRole = MEMBERSHIP_RELATION_MAP[membership.scopeType];
    const relation = relationByRole[membership.roleKey];
    if (relation === undefined) {
      throw new Error(
        `Combinación rol/scope inválida: el rol "${membership.roleKey}" no es asignable en el scope ${membership.scopeType} (§4.3).`,
      );
    }
    const objectType = SCOPE_OBJECT_TYPE[membership.scopeType];
    return {
      user: `user:${membership.userId}`,
      relation,
      object: `${objectType}:${membership.scopeId}`,
    };
  }

  /**
   * Sincroniza la asignación de un rol CUSTOM a un usuario en un scope dado
   * (org o project) hacia OpenFGA: por cada grant STRUCTURAL del rol cuyo
   * object type (vía COMPOSABLE_STRUCTURAL) coincide con `scopeType`, escribe
   * o borra la tupla directa `(user, fgaRelation, objectType:scopeId)`.
   *
   * Semántica multi-rol (A5): el set FGA deseado para (usuario, objeto) es la
   * UNIÓN de los grants STRUCTURAL de TODOS sus roles custom sobre ese objeto.
   * Las tuplas que otro rol custom sigue sosteniendo NO se borran en 'delete'
   * ni se re-escriben en 'create' (el write de OpenFGA no es idempotente).
   * Tuplas deduplicadas por "user|relation|object" (5 permisos comparten can_view).
   */
  async syncRoleAssignment(input: RoleAssignmentInput, op: MembershipSyncOp): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { key: input.roleKey },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) return;

    const { objectType, object } = objectOf(input.scopeType, input.scopeId);
    const tuples = this.dedupeTuples(
      this.tuplesFromGrants(
        role.permissions as unknown as StructuralGrant[],
        input.userId,
        objectType,
        object,
      ),
    );
    if (tuples.length === 0) return;

    const sustained = await this.tuplesSustainedByOtherCustomRoles(input);
    const effective = tuples.filter((t) => !sustained.has(tupleId(t)));

    if (op === 'create') {
      await this.writeTuples(effective);
    } else {
      await this.deleteTuples(effective);
    }
  }

  /** Grants STRUCTURAL composables de un rol → tuplas FGA sobre `object` (sin dedupe). */
  private tuplesFromGrants(
    grants: StructuralGrant[],
    userId: string,
    objectType: 'organization' | 'project',
    object: string,
  ): TupleKey[] {
    const out: TupleKey[] = [];
    for (const grant of grants) {
      const { permission } = grant;
      if (permission.kind !== 'STRUCTURAL' || !permission.fgaRelation) continue;
      if (COMPOSABLE_STRUCTURAL[permission.key] !== objectType) continue;
      out.push({ user: `user:${userId}`, relation: permission.fgaRelation, object });
    }
    return out;
  }

  /** Dedupe por "user|relation|object" (varios permisos pueden compartir relación, p.ej. can_view). */
  private dedupeTuples(tuples: TupleKey[]): TupleKey[] {
    const seen = new Set<string>();
    const out: TupleKey[] = [];
    for (const tuple of tuples) {
      const id = tupleId(tuple);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(tuple);
    }
    return out;
  }

  /**
   * Set "user|relation|object" con la unión de grants STRUCTURAL de los DEMÁS
   * roles custom (isSystem=false) que el usuario tiene asignados sobre el
   * MISMO objeto. Funciona igual para create (la Membership nueva ya existe en
   * Postgres pero se excluye por roleKey) y delete (la Membership ya se borró).
   */
  private async tuplesSustainedByOtherCustomRoles(input: RoleAssignmentInput): Promise<Set<string>> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: input.userId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        roleKey: { not: input.roleKey },
      },
    });
    const otherKeys = [...new Set(memberships.map((m) => m.roleKey))];
    if (otherKeys.length === 0) return new Set();

    const roles = await this.prisma.role.findMany({
      where: { key: { in: otherKeys }, isSystem: false },
      include: { permissions: { include: { permission: true } } },
    });

    const { objectType, object } = objectOf(input.scopeType, input.scopeId);
    const sustained = new Set<string>();
    for (const role of roles) {
      const tuples = this.tuplesFromGrants(
        role.permissions as unknown as StructuralGrant[],
        input.userId,
        objectType,
        object,
      );
      for (const tuple of tuples) {
        sustained.add(tupleId(tuple));
      }
    }
    return sustained;
  }
}
