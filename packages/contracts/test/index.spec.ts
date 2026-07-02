/**
 * Contrato de forma del SPINE RBAC dinámico (§7 del design doc). El chequeo de
 * TIPOS lo hace `tsc -p tsconfig.test.json`, primera mitad del script `test`
 * de este paquete — vitest transforma con esbuild SIN typecheck, así que por
 * sí solo NO atraparía una regresión de tipos. Si alguien vuelve `RoleKey` a
 * unión cerrada o borra un export del SPINE, ese `tsc` falla (este archivo
 * deja de compilar); los `expect` de abajo cubren los valores de runtime
 * (ROLE_KEYS) y la composición de los tipos.
 */
import { describe, expect, it } from 'vitest';
import { ROLE_KEYS } from '../src/index';
import type {
  AssignRoleInput,
  CloneRoleResponse,
  CreateRoleInput,
  FgaObjectType,
  PermissionCatalogGroup,
  PermissionCatalogItem,
  PermissionKind,
  RoleDetail,
  RoleGrant,
  RoleKey,
  UpdateRoleInput,
  UserMembership,
} from '../src/index';

describe('RoleKey — unión abierta (§7)', () => {
  it('acepta cualquier string, no solo ROLE_KEYS (rol personalizado c_xxx)', () => {
    const custom: RoleKey = 'c_inspector_de_campo';
    expect(typeof custom).toBe('string');
    expect(ROLE_KEYS.includes(custom as (typeof ROLE_KEYS)[number])).toBe(false);
  });

  it('ROLE_KEYS se conserva como lista de roles del sistema', () => {
    expect(ROLE_KEYS).toContain('org_admin');
    expect(ROLE_KEYS).toContain('client_ito');
  });
});

describe('Tipos nuevos del SPINE — forma mínima (§7)', () => {
  it('PermissionCatalogItem/Group componen', () => {
    const item: PermissionCatalogItem = {
      key: 'project:read',
      label: 'Ver proyectos',
      module: 'proyectos',
      kind: 'STRUCTURAL' as PermissionKind,
      scopeable: true,
      fgaObjectType: 'project' as FgaObjectType,
      composable: true,
    };
    const group: PermissionCatalogGroup = { module: 'proyectos', items: [item] };
    expect(group.items[0]?.key).toBe('project:read');
  });

  it('RoleDetail/RoleGrant/CreateRoleInput/UpdateRoleInput/AssignRoleInput componen', () => {
    const grant: RoleGrant = { permissionKey: 'project:read', scope: 'PROJECT' };
    const detail: RoleDetail = {
      key: 'c_inspector',
      label: 'Inspector',
      description: null,
      isSystem: false,
      allowedScopeTypes: ['PROJECT'],
      grants: [grant],
    };
    const createInput: CreateRoleInput = { label: 'Inspector', grants: [grant] };
    const updateInput: UpdateRoleInput = { grants: [grant] };
    const assignInput: AssignRoleInput = {
      roleKey: 'c_inspector',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    };
    expect(detail.grants).toHaveLength(1);
    expect(createInput.label).toBe('Inspector');
    expect(updateInput.grants).toHaveLength(1);
    expect(assignInput.scopeType).toBe('PROJECT');
  });

  it('UserMembership/CloneRoleResponse componen (A4/A7)', () => {
    const membership: UserMembership = {
      roleKey: 'c_inspector',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    };
    const clone: CloneRoleResponse = {
      role: {
        key: 'c_qa_copia',
        label: 'QA (copia)',
        description: null,
        isSystem: false,
        allowedScopeTypes: ['PROJECT'],
        grants: [],
      },
      omittedPermissionKeys: ['document:sign:qa'],
    };
    expect(membership.scopeType).toBe('PROJECT');
    expect(clone.omittedPermissionKeys).toHaveLength(1);
  });
});
