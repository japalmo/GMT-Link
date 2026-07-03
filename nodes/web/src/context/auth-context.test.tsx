import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/context/auth-context';

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({
  getToken: mockGetToken,
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const { mockGetMe } = vi.hoisted(() => ({ mockGetMe: vi.fn() }));
vi.mock('@/lib/api', () => ({
  getMe: mockGetMe,
  login: vi.fn(),
  completeFirstLogin: vi.fn(),
}));

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <span>cargando</span>;
  return <span>canManageRoles:{String(user?.canManageRoles)}</span>;
}

describe('AuthProvider — expone canManageRoles del /auth/me', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetMe.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('propaga canManageRoles=true cuando el backend lo devuelve', async () => {
    mockGetToken.mockReturnValue('tok');
    mockGetMe.mockResolvedValue({
      id: 'u1',
      email: 'a@b.cl',
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'ACTIVE',
      modules: ['dashboard'],
      canManageRoles: true,
    });

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => screen.getByText('canManageRoles:true'));
  });
});
