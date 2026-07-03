import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  COMPOSABLE_STRUCTURAL,
  composable,
  fgaObjectTypeOf,
} from '../../../src/modules/roles/composable-permissions';
import type { PermissionKind } from '@gmt-platform/contracts';

interface FakePermission {
  key: string;
  kind: PermissionKind;
}

describe('composable-permissions (SPINE Fase 2)', () => {
  it('COMPOSABLE_STRUCTURAL contiene exactamente el mapa del SPINE', () => {
    expect(COMPOSABLE_STRUCTURAL).toEqual({
      'directory:view:extended': 'organization',
      'document:review': 'organization',
      'finance:manage': 'organization',
      'project:read': 'project',
      'project:kpi:define': 'project',
      'service:create': 'project',
      'measurement:submit': 'project',
      'measurement:read': 'project',
      'task:read': 'project',
      'task:create': 'project',
      'task:assign': 'project',
      'asset:manage': 'project',
    });
  });

  it('asset:manage es componible y aplica sobre project (gate propio de activos)', () => {
    const p: FakePermission = { key: 'asset:manage', kind: 'STRUCTURAL' };
    expect(composable(p)).toBe(true);
    expect(fgaObjectTypeOf(p)).toBe('project');
  });

  it('composable() es true para cualquier permiso FUNCTIONAL', () => {
    const p: FakePermission = { key: 'user:create', kind: 'FUNCTIONAL' };
    expect(composable(p)).toBe(true);
  });

  it('composable() es true para STRUCTURAL dentro del mapa', () => {
    const p: FakePermission = { key: 'task:read', kind: 'STRUCTURAL' };
    expect(composable(p)).toBe(true);
  });

  it('composable() es false para STRUCTURAL fuera del mapa', () => {
    const p: FakePermission = { key: 'document:sign:qa', kind: 'STRUCTURAL' };
    expect(composable(p)).toBe(false);
  });

  it('fgaObjectTypeOf() es null para FUNCTIONAL', () => {
    const p: FakePermission = { key: 'user:create', kind: 'FUNCTIONAL' };
    expect(fgaObjectTypeOf(p)).toBeNull();
  });

  it('fgaObjectTypeOf() devuelve "organization" para STRUCTURAL org-level', () => {
    const p: FakePermission = { key: 'finance:manage', kind: 'STRUCTURAL' };
    expect(fgaObjectTypeOf(p)).toBe('organization');
  });

  it('fgaObjectTypeOf() devuelve "project" para STRUCTURAL project-level', () => {
    const p: FakePermission = { key: 'task:assign', kind: 'STRUCTURAL' };
    expect(fgaObjectTypeOf(p)).toBe('project');
  });

  it('fgaObjectTypeOf() es null para STRUCTURAL fuera del mapa', () => {
    const p: FakePermission = { key: 'document:sign:client', kind: 'STRUCTURAL' };
    expect(fgaObjectTypeOf(p)).toBeNull();
  });
});
