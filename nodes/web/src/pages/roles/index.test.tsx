import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

const { mockUseRoles, mockToast } = vi.hoisted(() => ({
  mockUseRoles: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/hooks/use-roles', () => ({ useRoles: mockUseRoles }));
vi.mock('sonner', () => ({ toast: mockToast }));

import RolesPage from '@/pages/roles/index';

const catalog: PermissionCatalogGroup[] = [
  {
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
  },
];

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

function baseHook(overrides: Partial<ReturnType<typeof mockUseRoles>> = {}) {
  return {
    catalog,
    roles: [systemRole, customRole],
    systemRoles: [systemRole],
    customRoles: [customRole],
    loading: false,
    error: null,
    refetch: vi.fn(),
    getRole: vi.fn().mockResolvedValue(customRole),
    createRole: vi.fn().mockResolvedValue(customRole),
    updateRole: vi.fn().mockResolvedValue(customRole),
    deleteRole: vi.fn().mockResolvedValue(undefined),
    cloneRole: vi
      .fn()
      .mockResolvedValue({ role: { ...customRole, key: 'c_inspector_2' }, omittedPermissionKeys: [] }),
    ...overrides,
  };
}

describe('RolesPage', () => {
  beforeEach(() => {
    mockUseRoles.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('lista roles del sistema y personalizados en secciones separadas', () => {
    mockUseRoles.mockReturnValue(baseHook());
    render(<RolesPage />);

    expect(screen.getByText(/Del sistema/i)).toBeInTheDocument();
    expect(screen.getByText(/Personalizados/i)).toBeInTheDocument();
    expect(screen.getByText('Administrador de organización')).toBeInTheDocument();
    expect(screen.getByText('Inspector')).toBeInTheDocument();
  });

  it('estado de carga muestra el loader', () => {
    mockUseRoles.mockReturnValue(baseHook({ loading: true, roles: [], systemRoles: [], customRoles: [] }));
    render(<RolesPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('estado de error muestra el mensaje', () => {
    mockUseRoles.mockReturnValue(baseHook({ error: 'No se pudo cargar', roles: [], systemRoles: [], customRoles: [] }));
    render(<RolesPage />);

    expect(screen.getByText('No se pudo cargar')).toBeInTheDocument();
  });

  it('estado vacío cuando no hay roles personalizados', () => {
    mockUseRoles.mockReturnValue(baseHook({ customRoles: [] }));
    render(<RolesPage />);

    expect(screen.getByText(/No hay roles personalizados/i)).toBeInTheDocument();
  });

  it('seleccionar un rol personalizado abre su editor', async () => {
    const hook = baseHook();
    mockUseRoles.mockReturnValue(hook);
    render(<RolesPage />);

    fireEvent.click(screen.getByText('Inspector'));

    await waitFor(() => expect(hook.getRole).toHaveBeenCalledWith('c_inspector'));
  });

  it('botón Nuevo rol abre el diálogo de creación', () => {
    mockUseRoles.mockReturnValue(baseHook());
    render(<RolesPage />);

    fireEvent.click(screen.getByRole('button', { name: /Nuevo rol/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('crear desde "Nuevo rol" llama createRole con grants: [] (flujo crear→editar, A6)', async () => {
    const hook = baseHook();
    mockUseRoles.mockReturnValue(hook);
    render(<RolesPage />);

    fireEvent.click(screen.getByRole('button', { name: /Nuevo rol/i }));
    fireEvent.change(screen.getByLabelText(/Nombre/i), { target: { value: 'Inspector terreno' } });
    fireEvent.click(screen.getByRole('button', { name: /^Crear$/i }));

    await waitFor(() =>
      expect(hook.createRole).toHaveBeenCalledWith({ label: 'Inspector terreno', grants: [] }),
    );
  });

  it('clonar muestra un aviso listando los permisos omitidos (A7)', async () => {
    const hook = baseHook({
      getRole: vi.fn().mockResolvedValue(systemRole),
      cloneRole: vi.fn().mockResolvedValue({
        role: { ...customRole, key: 'c_administrador_de_organizacion_copia' },
        omittedPermissionKeys: ['directory:view:extended', 'document:review'],
      }),
    });
    mockUseRoles.mockReturnValue(hook);
    render(<RolesPage />);

    fireEvent.click(screen.getByText('Administrador de organización'));
    await waitFor(() => screen.getByRole('button', { name: /Clonar/i }));
    fireEvent.click(screen.getByRole('button', { name: /Clonar/i }));

    await waitFor(() => expect(hook.cloneRole).toHaveBeenCalled());
    expect(mockToast.warning).toHaveBeenCalledWith(expect.stringContaining('directory:view:extended'));
    expect(mockToast.warning).toHaveBeenCalledWith(expect.stringContaining('document:review'));
  });

  it('eliminar un rol personalizado pide confirmación antes de borrar', async () => {
    const hook = baseHook();
    mockUseRoles.mockReturnValue(hook);
    render(<RolesPage />);

    // Click en "Eliminar" NO borra todavía: abre el diálogo de confirmación.
    fireEvent.click(screen.getByRole('button', { name: /Eliminar rol Inspector/i }));
    expect(hook.deleteRole).not.toHaveBeenCalled();
    await waitFor(() => screen.getByText(/¿Eliminar rol\?/i));

    // Confirmar en el diálogo → recién ahí se borra con la key correcta.
    fireEvent.click(screen.getByRole('button', { name: /^Eliminar rol$/i }));
    await waitFor(() => expect(hook.deleteRole).toHaveBeenCalledWith('c_inspector'));
    expect(mockToast.success).toHaveBeenCalledWith('Rol eliminado.');
  });
});
