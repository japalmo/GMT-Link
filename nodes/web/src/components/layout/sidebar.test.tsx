import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarContent } from '@/components/layout/sidebar';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('@/context/auth-context', () => ({ useAuth: mockUseAuth }));
vi.mock('@/components/layout/use-sidebar', () => ({
  useSidebar: () => ({ collapsed: false, toggleCollapsed: vi.fn() }),
}));
vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: () => null,
}));

function baseUser(overrides: Partial<{ modules: string[]; canManageRoles: boolean }> = {}) {
  return {
    id: 'u1',
    email: 'a@b.cl',
    firstName: 'Ada',
    lastName: 'Lovelace',
    status: 'ACTIVE' as const,
    modules: ['dashboard', 'usuarios'],
    permissions: [] as string[],
    canManageRoles: false,
    ...overrides,
  };
}

describe('SidebarContent — Usuarios (Roles vive como pestaña dentro de Usuarios)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('muestra "Usuarios" cuando el módulo está disponible', () => {
    mockUseAuth.mockReturnValue({ user: baseUser({ canManageRoles: true }), logout: vi.fn() });
    render(<MemoryRouter><SidebarContent /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /Usuarios/i })).toBeInTheDocument();
  });

  it('ya no existe un enlace de menú "Roles" separado (es una pestaña dentro de Usuarios)', () => {
    mockUseAuth.mockReturnValue({ user: baseUser({ canManageRoles: true }), logout: vi.fn() });
    render(<MemoryRouter><SidebarContent /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: /^Roles$/i })).not.toBeInTheDocument();
  });
});
