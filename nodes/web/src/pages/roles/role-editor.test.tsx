import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';
import { RoleEditor } from '@/pages/roles/role-editor';

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
      {
        key: 'task:create',
        label: 'Crear tarea',
        module: 'operaciones',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: 'project',
        composable: true,
      },
      {
        key: 'document:review',
        label: 'Revisar documentos',
        module: 'documentos',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: null,
        composable: false,
      },
    ],
  },
  {
    module: 'directorio',
    items: [
      {
        key: 'directory:view:extended',
        label: 'Ver directorio extendido',
        module: 'directorio',
        kind: 'STRUCTURAL',
        scopeable: true,
        fgaObjectType: 'organization',
        composable: true,
      },
    ],
  },
];

const customRole: RoleDetail = {
  key: 'c_inspector',
  label: 'Inspector',
  description: 'Inspecciona avance en terreno',
  isSystem: false,
  allowedScopeTypes: ['PROJECT'],
  grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
};

const systemRole: RoleDetail = {
  key: 'org_admin',
  label: 'Administrador de organización',
  description: null,
  isSystem: true,
  allowedScopeTypes: ['ORGANIZATION'],
  grants: [{ permissionKey: 'directory:view:extended', scope: 'GLOBAL' }],
};

describe('RoleEditor', () => {
  it('rol personalizado: permite editar nombre, descripción y toggles de permisos', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleEditor role={customRole} catalog={catalog} onSave={onSave} onClone={vi.fn()} />);

    expect(screen.getByDisplayValue('Inspector')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ver proyecto/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Crear tarea/i })).not.toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: /Crear tarea/i }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [, input] = onSave.mock.calls[0] as [string, { grants: Array<{ permissionKey: string }> }];
    const keys = input.grants.map((g) => g.permissionKey).sort();
    expect(keys).toEqual(['project:read', 'task:create']);
  });

  it('ítems composable=false aparecen deshabilitados', () => {
    render(<RoleEditor role={customRole} catalog={catalog} onSave={vi.fn()} onClone={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: /Revisar documentos/i })).toBeDisabled();
  });

  it('rol del sistema: solo lectura, sin botón Guardar, con botón Clonar', () => {
    const onClone = vi.fn();
    render(<RoleEditor role={systemRole} catalog={catalog} onSave={vi.fn()} onClone={onClone} />);

    expect(screen.queryByRole('button', { name: /Guardar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ver directorio extendido/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Clonar/i }));
    expect(onClone).toHaveBeenCalledWith('org_admin');
  });

  it('permiso scopeable muestra selector de alcance (OWN/PROJECT/GLOBAL)', () => {
    render(<RoleEditor role={customRole} catalog={catalog} onSave={vi.fn()} onClone={vi.fn()} />);

    expect(screen.getByLabelText(/Alcance de Ver directorio extendido/i)).toBeInTheDocument();
  });
});
