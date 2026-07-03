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
    canManageRoles: false,
    ...overrides,
  };
}

describe('SidebarContent — gating de "Roles" por canManageRoles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('no muestra "Roles" si canManageRoles=false', () => {
    mockUseAuth.mockReturnValue({ user: baseUser({ canManageRoles: false }), logout: vi.fn() });
    render(<MemoryRouter><SidebarContent /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: /Roles/i })).not.toBeInTheDocument();
  });

  it('muestra "Roles" si canManageRoles=true', () => {
    mockUseAuth.mockReturnValue({ user: baseUser({ canManageRoles: true }), logout: vi.fn() });
    render(<MemoryRouter><SidebarContent /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /Roles/i })).toBeInTheDocument();
  });
});
