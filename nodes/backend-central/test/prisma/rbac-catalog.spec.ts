import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES } from '../../prisma/rbac-catalog';

const permKeys = new Set(PERMISSIONS.map((p) => p.key));
const roleByKey = new Map(ROLES.map((r) => [r.key, r]));

const SYSTEM_ROLES_FASE1 = [
  'trabajador',
  'admin_contrato',
  'admin_finanzas',
  'analista_rh',
  'analista_finanzas',
  'asesor_hse',
  'gerencia_proyectos',
  'gerencia_general',
  'gerencia_rh',
  'admin_ti',
];

describe('rbac-catalog — invariantes', () => {
  it('todas las claves de permiso son únicas', () => {
    expect(permKeys.size).toBe(PERMISSIONS.length);
  });

  it('los 6 permisos nuevos de finanzas + 5 de proyectos + system:beta:full existen', () => {
    for (const k of [
      'finance:request:create',
      'finance:overtime:create:onbehalf',
      'finance:request:view:all',
      'finance:overtime:view:all',
      'finance:request:approve',
      'finance:payment:register',
      'project:view:all',
      'project:manage',
      'project:doc:upload:worker',
      'project:doc:upload:project',
      'project:doc:upload:hse',
      'system:beta:full',
    ]) {
      expect(permKeys.has(k)).toBe(true);
    }
  });

  it('cada grant de cada rol referencia un permiso existente', () => {
    for (const role of ROLES) {
      for (const grant of role.grants) {
        expect(permKeys.has(grant.perm)).toBe(true);
      }
    }
  });

  it('los 10 roles de sistema de Fase 1 están sembrados', () => {
    for (const k of SYSTEM_ROLES_FASE1) {
      expect(roleByKey.has(k)).toBe(true);
    }
  });

  it('admin_contrato y gerencia_proyectos tienen bundles idénticos', () => {
    const a = roleByKey.get('admin_contrato')!.grants;
    const b = roleByKey.get('gerencia_proyectos')!.grants;
    expect(new Set(a.map((x) => x.perm))).toEqual(new Set(b.map((x) => x.perm)));
  });

  it('gerencia_rh y gerencia_general otorgan system:beta:full', () => {
    for (const k of ['gerencia_rh', 'gerencia_general']) {
      expect(roleByKey.get(k)!.grants.some((x) => x.perm === 'system:beta:full')).toBe(true);
    }
  });

  it('org_admin y admin_ti NO otorgan system:beta:full (no ven el banner beta)', () => {
    for (const k of ['org_admin', 'admin_ti']) {
      expect(roleByKey.get(k)!.grants.some((x) => x.perm === 'system:beta:full')).toBe(false);
    }
  });

  it('trabajador otorga SOLO los derechos base: finance:request:create + inventory:request:own, ambos GLOBAL', () => {
    const t = roleByKey.get('trabajador')!.grants;
    expect(new Set(t.map((x) => `${x.perm}@${x.scope}`))).toEqual(
      new Set(['finance:request:create@GLOBAL', 'inventory:request:own@GLOBAL']),
    );
  });

  it('RESOLUCIÓN #2: LOS 10 roles de sistema otorgan finance:request:create (todos crean lo propio)', () => {
    for (const k of SYSTEM_ROLES_FASE1) {
      const grants = roleByKey.get(k)!.grants;
      const grant = grants.find((x) => x.perm === 'finance:request:create');
      expect(grant, `rol ${k} debe otorgar finance:request:create`).toBeDefined();
      expect(grant!.scope).toBe('GLOBAL');
    }
  });

  it('org_admin y admin_ti también incluyen finance:request:create (vía ALL_GLOBAL_EXCEPT_BETA)', () => {
    for (const k of ['org_admin', 'admin_ti']) {
      expect(roleByKey.get(k)!.grants.some((x) => x.perm === 'finance:request:create' && x.scope === 'GLOBAL')).toBe(true);
    }
  });

  it('asset:read existe como permiso FUNCTIONAL de módulo recursos (solo lectura, siempre GLOBAL)', () => {
    const p = PERMISSIONS.find((x) => x.key === 'asset:read');
    expect(p, 'asset:read debe existir en el catálogo').toBeDefined();
    expect(p!.kind).toBe('FUNCTIONAL');
    expect(p!.module).toBe('recursos');
    expect(p!.scopeable).toBe(false);
  });

  it('admin_contrato, admin_finanzas y gerencia_proyectos otorgan asset:read a GLOBAL (acceso de solo lectura a Recursos)', () => {
    for (const k of ['admin_contrato', 'admin_finanzas', 'gerencia_proyectos']) {
      const grant = roleByKey.get(k)!.grants.find((x) => x.perm === 'asset:read');
      expect(grant, `rol ${k} debe otorgar asset:read`).toBeDefined();
      expect(grant!.scope).toBe('GLOBAL');
    }
  });

  it('inventory:access existe como permiso FUNCTIONAL del módulo inventario (siempre GLOBAL)', () => {
    const p = PERMISSIONS.find((x) => x.key === 'inventory:access');
    expect(p, 'inventory:access debe existir en el catálogo').toBeDefined();
    expect(p!.kind).toBe('FUNCTIONAL');
    expect(p!.module).toBe('inventario');
    expect(p!.scopeable).toBe(false);
  });

  it('logistica es rol de sistema con inventario + bodegas + proveedores + solicitudes propias, todo a GLOBAL', () => {
    const role = roleByKey.get('logistica');
    expect(role, 'el rol logistica debe existir').toBeDefined();
    expect(new Set(role!.grants.map((x) => `${x.perm}@${x.scope}`))).toEqual(
      new Set([
        'inventory:access@GLOBAL',
        'warehouse:access@GLOBAL',
        'provider:access@GLOBAL',
        'finance:request:create@GLOBAL',
        'inventory:request:own@GLOBAL',
      ]),
    );
  });

  it('inventory:request:own existe como permiso FUNCTIONAL del módulo inventario (siempre GLOBAL)', () => {
    const p = PERMISSIONS.find((x) => x.key === 'inventory:request:own');
    expect(p, 'inventory:request:own debe existir en el catálogo').toBeDefined();
    expect(p!.kind).toBe('FUNCTIONAL');
    expect(p!.module).toBe('inventario');
    expect(p!.scopeable).toBe(false);
  });

  it('ESPEJO EXACTO: todo rol otorga inventory:request:own si y solo si otorga finance:request:create, con el mismo scope', () => {
    for (const role of ROLES) {
      const finance = role.grants.find((x) => x.perm === 'finance:request:create');
      const inventory = role.grants.find((x) => x.perm === 'inventory:request:own');
      expect(
        Boolean(inventory),
        `rol ${role.key}: inventory:request:own debe espejar finance:request:create`,
      ).toBe(Boolean(finance));
      if (finance && inventory) {
        expect(inventory.scope, `rol ${role.key}: mismo scope que finance:request:create`).toBe(
          finance.scope,
        );
      }
    }
  });

  it('client_ito y viewer NO otorgan inventory:request:own (los externos no solicitan insumos)', () => {
    for (const k of ['client_ito', 'viewer']) {
      expect(roleByKey.get(k)!.grants.some((x) => x.perm === 'inventory:request:own')).toBe(false);
    }
  });

  it('department_admin otorga inventory:access a GLOBAL (es admin del módulo Inventario)', () => {
    const grant = roleByKey.get('department_admin')!.grants.find((x) => x.perm === 'inventory:access');
    expect(grant, 'department_admin debe otorgar inventory:access').toBeDefined();
    expect(grant!.scope).toBe('GLOBAL');
  });

  it('org_admin y admin_ti incluyen inventory:access (vía ALL_GLOBAL_EXCEPT_BETA)', () => {
    for (const k of ['org_admin', 'admin_ti']) {
      expect(roleByKey.get(k)!.grants.some((x) => x.perm === 'inventory:access' && x.scope === 'GLOBAL')).toBe(true);
    }
  });
});
