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
}
