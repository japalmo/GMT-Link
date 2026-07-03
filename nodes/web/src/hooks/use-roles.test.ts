import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { CloneRoleResponse, PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

const {
  mockGetPermissionsCatalog,
  mockListRoles,
  mockGetRole,
  mockCreateRole,
  mockUpdateRole,
  mockDeleteRole,
  mockCloneRole,
} = vi.hoisted(() => ({
  mockGetPermissionsCatalog: vi.fn(),
  mockListRoles: vi.fn(),
  mockGetRole: vi.fn(),
  mockCreateRole: vi.fn(),
  mockUpdateRole: vi.fn(),
  mockDeleteRole: vi.fn(),
  mockCloneRole: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getPermissionsCatalog: mockGetPermissionsCatalog,
  listRoles: mockListRoles,
  getRole: mockGetRole,
  createRole: mockCreateRole,
  updateRole: mockUpdateRole,
  deleteRole: mockDeleteRole,
  cloneRole: mockCloneRole,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { useRoles } from '@/hooks/use-roles';

const group: PermissionCatalogGroup = {
  module: 'operaciones',
  items: [
    {
      key: 'project:read',
      label: 'Ver proyecto',
      module: 'operaciones',
      kind: 'STRUCTURAL',
      scopeable: false,
      fgaObjectType: 'project',
      composable: true,
    },
  ],
};

const systemRole: RoleDetail = {
  key: 'org_admin',
  label: 'Administrador de organización',
  description: null,
  isSystem: true,
  allowedScopeTypes: ['ORGANIZATION'],
  grants: [],
};

const customRole: RoleDetail = {
  key: 'c_inspector',
  label: 'Inspector',
  description: null,
  isSystem: false,
  allowedScopeTypes: ['PROJECT'],
  grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
};

describe('useRoles', () => {
  beforeEach(() => {
    mockGetPermissionsCatalog.mockReset().mockResolvedValue([group]);
    mockListRoles.mockReset().mockResolvedValue([systemRole, customRole]);
    mockGetRole.mockReset();
    mockCreateRole.mockReset();
    mockUpdateRole.mockReset();
    mockDeleteRole.mockReset();
    mockCloneRole.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('carga catálogo y roles al montar; separa sistema/personalizados', async () => {
    const { result } = renderHook(() => useRoles());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.catalog).toEqual([group]);
    expect(result.current.systemRoles).toEqual([systemRole]);
    expect(result.current.customRoles).toEqual([customRole]);
    expect(result.current.error).toBeNull();
  });

  it('error de carga se refleja en error y no rompe', async () => {
    mockListRoles.mockRejectedValue(new Error('caído'));
    const { result } = renderHook(() => useRoles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('caído');
  });

  it('createRole delega en la API y refresca la lista', async () => {
    mockCreateRole.mockResolvedValue(customRole);
    mockListRoles.mockResolvedValueOnce([systemRole]).mockResolvedValueOnce([systemRole, customRole]);
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createRole({ label: 'Inspector', grants: customRole.grants });
    });

    expect(mockCreateRole).toHaveBeenCalledWith({ label: 'Inspector', grants: customRole.grants });
    await waitFor(() => expect(result.current.customRoles).toEqual([customRole]));
  });

  it('deleteRole delega y refresca', async () => {
    mockDeleteRole.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteRole('c_inspector');
    });

    expect(mockDeleteRole).toHaveBeenCalledWith('c_inspector');
  });

  it('cloneRole delega en la API y devuelve el CloneRoleResponse (role + omittedPermissionKeys)', async () => {
    const cloned: CloneRoleResponse = {
      role: { ...customRole, key: 'c_inspector_2', label: 'Inspector (copia)' },
      omittedPermissionKeys: ['document:review'],
    };
    mockCloneRole.mockResolvedValue(cloned);
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: CloneRoleResponse | undefined;
    await act(async () => {
      returned = await result.current.cloneRole('org_admin', 'Inspector (copia)');
    });

    expect(mockCloneRole).toHaveBeenCalledWith('org_admin', 'Inspector (copia)');
    expect(returned).toEqual(cloned);
  });
});
