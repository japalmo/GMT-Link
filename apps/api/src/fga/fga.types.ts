/**
 * Tipos del contrato de FgaService — Etapa 0.3 (plan maestro §4.1, §4.3).
 * Otro agente consume este contrato en paralelo: NO cambiar firmas.
 */

/** Tupla OpenFGA: user:{id} / relación / {tipo}:{id}. */
export interface TupleKey {
  user: string;
  relation: string;
  object: string;
}

/** Scopes de Membership (espejo del enum ScopeType de Prisma, §4.2). */
export type FgaScopeType = 'ORGANIZATION' | 'DEPARTMENT' | 'PROJECT' | 'SERVICE';

/** Entrada para sincronizar una Membership de Postgres hacia OpenFGA (§4.1). */
export interface MembershipInput {
  userId: string;
  roleKey: string;
  scopeType: FgaScopeType;
  scopeId: string;
}

export type MembershipSyncOp = 'create' | 'delete';

/** Tipo de objeto FGA por scope (§4.3). */
export const SCOPE_OBJECT_TYPE: Readonly<Record<FgaScopeType, string>> = {
  ORGANIZATION: 'organization',
  DEPARTMENT: 'department',
  PROJECT: 'project',
  SERVICE: 'service',
};

/**
 * Tabla de mapeo roleKey + scopeType → relación FGA (§4.1/§4.3).
 *  - org_admin + ORGANIZATION → organization#admin
 *  - department_admin + DEPARTMENT → department#admin
 *  - roles de proyecto + PROJECT → project#<roleKey>
 *  - operator|qa + SERVICE → service#<roleKey> · client_signer + SERVICE → service#client_signer
 * Cualquier combinación fuera de la tabla es inválida.
 */
export const MEMBERSHIP_RELATION_MAP: Readonly<
  Record<FgaScopeType, Readonly<Record<string, string>>>
> = {
  ORGANIZATION: { org_admin: 'admin' },
  DEPARTMENT: { department_admin: 'admin' },
  PROJECT: {
    project_creator: 'project_creator',
    operator: 'operator',
    qa: 'qa',
    finance: 'finance',
    viewer: 'viewer',
    client_ito: 'client_ito',
  },
  SERVICE: {
    operator: 'operator',
    qa: 'qa',
    client_signer: 'client_signer',
  },
};

/**
 * Superficie mínima del cliente OpenFGA que usa FgaService.
 * `OpenFgaClient` la satisface estructuralmente; los tests inyectan un fake.
 */
export interface FgaClientLike {
  check(body: { user: string; relation: string; object: string }): Promise<{ allowed?: boolean }>;
  write(body: { writes?: TupleKey[]; deletes?: TupleKey[] }): Promise<unknown>;
}

/** Token de inyección para sustituir el cliente FGA (tests / configuración avanzada). */
export const FGA_CLIENT = Symbol('FGA_CLIENT');
