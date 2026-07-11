import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHasPermission } from '@/hooks/use-has-permission';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('@/context/auth-context', () => ({ useAuth: mockUseAuth }));

describe('useHasPermission', () => {
  afterEach(() => vi.restoreAllMocks());

  it('true si el permiso está en user.permissions', () => {
    mockUseAuth.mockReturnValue({ user: { permissions: ['project:manage'] } });
    expect(renderHook(() => useHasPermission('project:manage')).result.current).toBe(true);
  });

  it('false si no está', () => {
    mockUseAuth.mockReturnValue({ user: { permissions: ['finance:request:create'] } });
    expect(renderHook(() => useHasPermission('project:manage')).result.current).toBe(false);
  });

  it('false (fail-closed) si no hay usuario', () => {
    mockUseAuth.mockReturnValue({ user: null });
    expect(renderHook(() => useHasPermission('x')).result.current).toBe(false);
  });
});
