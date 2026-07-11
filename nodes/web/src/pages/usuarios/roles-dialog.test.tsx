import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RoleDetail, UserMembership } from '@gmt-platform/contracts';

const { mockListRoles, mockListProjects } = vi.hoisted(() => ({
  mockListRoles: vi.fn(),
  mockListProjects: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ listRoles: mockListRoles, listProjects: mockListProjects }));

import { RolesDialog } from '@/pages/usuarios/roles-dialog';
import type { UserListItem, UserRolesResponse } from '@/lib/api';

const orgRole: RoleDetail = {
  key: 'org_admin',
  label: 'Administrador de organización',
  description: null,
  isSystem: true,
  allowedScopeTypes: ['ORGANIZATION'],
  grants: [],
};

const projectRole: RoleDetail = {
  key: 'c_inspector',
  label: 'Inspector',
  description: null,
  isSystem: false,
  allowedScopeTypes: ['PROJECT'],
  grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
};

const orgMembership: UserMembership = { roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' };
const projMembership: UserMembership = { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' };

const user: UserListItem = {
  id: 'u1',
  firstName: 'Ada',
  secondName: null,
  lastName: 'Lovelace',
  secondLastName: null,
  email: 'ada@gmt.cl',
  username: 'ada',
  emailInstitucional: 'ada@gmt.cl',
  emailPersonal: null,
  status: 'ACTIVE',
  isClientUser: false,
  roleKeys: ['org_admin', 'c_inspector'],
  memberships: [orgMembership, projMembership],
  createdAt: new Date().toISOString(),
};

const emptyUser: UserListItem = { ...user, id: 'u2', roleKeys: [], memberships: [] };

describe('RolesDialog — chips por membership + asignación con alcance', () => {
  beforeEach(() => {
    mockListRoles.mockReset().mockResolvedValue([orgRole, projectRole]);
    mockListProjects.mockReset().mockResolvedValue([{ id: 'p1', code: 'P-001', name: 'Proyecto Uno' }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renderiza un chip POR MEMBERSHIP con badge de alcance (Organización / Proyecto X)', async () => {
    render(
      <RolesDialog
        user={user}
        onOpenChange={vi.fn()}
        onAssign={vi.fn()}
        onRemove={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    // Las etiquetas de rol aparecen cuando listRoles resuelve; el nombre del
    // proyecto cuando listProjects resuelve.
    expect(await screen.findByText('Administrador de organización')).toBeInTheDocument();
    expect(screen.getByText('Organización')).toBeInTheDocument();
    expect(await screen.findByText('P-001 — Proyecto Uno')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Quitar rol Inspector \(P-001 — Proyecto Uno\)/i }),
    ).toBeInTheDocument();
  });

  it('quitar pasa {roleKey, scopeType, scopeId} EXACTOS de la membership (H13, nada hardcodeado)', async () => {
    const onRemove = vi.fn().mockResolvedValue({
      id: 'u1',
      roleKeys: ['org_admin'],
      memberships: [orgMembership],
    } satisfies UserRolesResponse);
    render(
      <RolesDialog
        user={user}
        onOpenChange={vi.fn()}
        onAssign={vi.fn()}
        onRemove={onRemove}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Quitar rol Inspector/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Quitar rol$/ })); // confirmar

    await waitFor(() =>
      expect(onRemove).toHaveBeenCalledWith('u1', { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' }),
    );
    // El chip de esa membership desaparece con la respuesta del backend.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Quitar rol Inspector/i })).not.toBeInTheDocument(),
    );
  });

  it('al elegir un rol PROJECT-only, exige seleccionar proyecto antes de habilitar Agregar', async () => {
    const onAssign = vi.fn().mockResolvedValue({
      id: 'u2',
      roleKeys: ['c_inspector'],
      memberships: [projMembership],
    } satisfies UserRolesResponse);
    render(
      <RolesDialog
        user={emptyUser}
        onOpenChange={vi.fn()}
        onAssign={onAssign}
        onRemove={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /Agregar rol/i })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /Agregar rol/i }), { target: { value: 'c_inspector' } });

    // El selector de alcance queda limitado a PROJECT (único allowedScopeTypes del rol).
    expect(screen.getByRole('combobox', { name: /Alcance/i })).toHaveValue('PROJECT');
    // Y aparece el selector de proyecto.
    expect(await screen.findByRole('combobox', { name: /Proyecto/i })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Agregar/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: /Proyecto/i }), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar/i }));

    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledWith('u2', { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' }),
    );
  });

  it('rol ORGANIZATION-only no muestra selector de proyecto y asigna directo', async () => {
    const onAssign = vi.fn().mockResolvedValue({
      id: 'u2',
      roleKeys: ['org_admin'],
      memberships: [orgMembership],
    } satisfies UserRolesResponse);
    render(
      <RolesDialog
        user={emptyUser}
        onOpenChange={vi.fn()}
        onAssign={onAssign}
        onRemove={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /Agregar rol/i })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /Agregar rol/i }), { target: { value: 'org_admin' } });

    expect(screen.queryByRole('combobox', { name: /Proyecto/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Agregar/i }));

    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledWith('u2', { roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
    );
  });
});
